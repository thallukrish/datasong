import { addUsage, arr, key, modelJson, text } from '../query_v2/modelJson.js';

const MAX_FIELDS = 12;
const FIELDS_PER_DIMENSION = 3;
const COVERAGE_SYSTEM = `Judge ACTUAL query-dimension coverage from one entity state's supplied evidence. Return JSON only: {"d":[[dimensionIndex,fieldIndex]]}. Include a pair ONLY when the cited supplied field DIRECTLY evidences that missing dimension. Omit the dimension otherwise. The fieldIndex MUST refer to a field in e.f. Do not infer coverage from the entity's business context, likely related entities, path, possible future joins, or what an ID might point to. IDs establish identity/connectivity only; quantity/count does not establish monetary sales amount; a generic/store/product ID does not establish region or monetary amount; a dimension needing date/time requires an actual date/time field. This is a binary evidence assertion, not a relevance or confidence score. No reasons, names, confidence values, or extra keys.`;

function words(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
}

function fieldRelevance(field, dimension) {
  const wanted = new Set(words(dimension));
  if (!wanted.size) return 0;
  const nameWords = words(field?.name);
  const descriptionWords = words(field?.description);
  let score = 0;
  for (const word of wanted) {
    if (nameWords.includes(word)) score += 3;
    if (descriptionWords.includes(word)) score += 1;
  }
  return score;
}

function joinFieldNames(state) {
  const names = new Set();
  for (const map of arr(state?.edge?.join?.keyMaps)) {
    if (map?.fieldName) names.add(key(map.fieldName));
    if (map?.relatedFieldName) names.add(key(map.relatedFieldName));
  }
  return names;
}

function semanticHintFieldNames(state) {
  return new Set(arr(state?.evidence?.semanticFields).map((item) => key(item?.field)).filter(Boolean));
}

function selectFields(state, missingDimensions) {
  const fields = arr(state?.schemaFields);
  const selected = new Map();
  const add = (field, reason) => {
    const k = key(field?.name);
    if (!k || selected.has(k) || selected.size >= MAX_FIELDS) return;
    selected.set(k, { field, reason });
  };

  for (const dimension of missingDimensions) {
    fields
      .map((field) => ({ field, score:fieldRelevance(field, dimension) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, FIELDS_PER_DIMENSION)
      .forEach((item) => add(item.field, `dimension:${dimension}`));
  }

  const joinNames = joinFieldNames(state);
  for (const field of fields) if (joinNames.has(key(field.name))) add(field, 'join');

  const hintNames = semanticHintFieldNames(state);
  for (const field of fields) if (hintNames.has(key(field.name))) add(field, 'semantic_hint');

  return [...selected.values()].map(({ field, reason }, index) => ({
    index,
    name:text(field.name, 120),
    type:text(field.type, 60),
    isPk:!!field.isPk,
    description:text(field.description, 120),
    reason
  }));
}

export async function evaluateEntityCoverage({ state, dimensions, missingDimensions, client, model, usage, log, step }) {
  if (state?.type !== 'entity' || !state?.evidence) return [];
  const missing = new Set(missingDimensions);
  const fields = selectFields(state, missingDimensions);
  if (!fields.length) {
    log('query_v3_coverage_model', { step, entity:state.entityName || state.name, covered:[], skipped:'no-relevant-schema-fields', cumulativeUsage:{...usage} });
    return [];
  }

  const payload = {
    d:dimensions.map((name, index) => [index, name]),
    u:dimensions.map((name, index) => missing.has(name) ? index : null).filter((v) => v !== null),
    e:{
      n:state.evidence?.entity?.name || state.entityName || state.name,
      x:text(state.evidence?.entity?.description, 160),
      f:fields.map((field) => [field.index, field.name, field.type, field.isPk ? 1 : 0, field.description])
    }
  };
  log('query_v3_coverage_payload', { step, entity:state.entityName || state.name, payload });
  const call = await modelJson(client, model, COVERAGE_SYSTEM, payload, { maxTokens:120 });
  addUsage(usage, call.usage);

  const fieldIndexes = new Set(fields.map((field) => field.index));
  const covered = arr(call.parsed?.d).map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const index = Number(pair[0]);
    const dimension = dimensions[index];
    const fieldIndex = Number(pair[1]);
    if (!dimension || !missing.has(dimension) || !fieldIndexes.has(fieldIndex)) return null;
    const field = fields.find((item) => item.index === fieldIndex);
    return { dimension, field:field?.name || '' };
  }).filter(Boolean);

  log('query_v3_coverage_model', { step, entity:state.entityName || state.name, covered, usage:call.usage, cumulativeUsage:{...usage} });
  return covered;
}

export function coverageState(dimensions, accepted) {
  const covered = new Set();
  for (const item of accepted.values()) for (const dim of arr(item.covered)) covered.add(dim.dimension);
  return { covered:[...covered], missing:dimensions.filter((name) => !covered.has(name)) };
}
