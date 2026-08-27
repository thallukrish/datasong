import { addUsage, arr, key, modelJson, text } from '../query_v2/modelJson.js';

const MAX_FIELDS = 12;
const FIELDS_PER_DIMENSION = 3;
const COVERAGE_SYSTEM = `Judge ACTUAL coverage for exactly ONE query dimension from one entity state's supplied schema fields. Return JSON only: {"field":fieldIndexOrMinus1}. Return a field index ONLY when that exact supplied field DIRECTLY provides data for the requested dimension. Otherwise return -1. Do not infer from business context, entity name, likely related entities, path, or possible future joins. IDs establish identity/connectivity only unless the dimension itself is that exact identifier. A product/store/customer ID does not directly provide region. Quantity/count does not directly provide monetary sales amount. A time dimension requires an actual date/time field. No reasons or extra keys.`;
const REPAIR_COVERAGE_SYSTEM = `Judge ACTUAL repair coverage for exactly ONE reopened query dimension from one entity state's supplied schema fields. Return JSON only: {"field":fieldIndexOrMinus1}. The repair requirement, locked evidence, and current evidenced path are authoritative context. Return a field index ONLY when that exact supplied field directly provides the requested reopened dimension AND semantically satisfies the stated repair requirement relative to the locked evidence. Do not accept a generic field merely because its primitive type/name matches the dimension. Example: a product lifecycle date must NOT satisfy transaction_time when the requirement is the observation time of the locked sales measure. Locked evidence must remain valid and must not be reinterpreted or replaced. Structural connectivity along the supplied current path is evidenced; judge the business/analytical relationship, not direct adjacency. Otherwise return -1. No reasons or extra keys.`;

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

export async function evaluateEntityCoverage({ state, dimensions, missingDimensions, client, model, usage, log, step, repairContext = null }) {
  if (state?.type !== 'entity' || !state?.evidence) return [];
  const fields = selectFields(state, missingDimensions);
  if (!fields.length) {
    log('query_v4_coverage_model', { step, entity:state.entityName || state.name, covered:[], skipped:'no-relevant-schema-fields', repair:!!repairContext, cumulativeUsage:{...usage} });
    return [];
  }

  const covered = [];
  for (const dimension of missingDimensions) {
    const payload = {
      dimension,
      entity:{
        name:state.evidence?.entity?.name || state.entityName || state.name,
        description:text(state.evidence?.entity?.description, 160)
      },
      fields:fields.map((field) => [field.index, field.name, field.type, field.isPk ? 1 : 0, field.description])
    };
    if (repairContext) {
      payload.repair = {
        requirement:text(repairContext.requirement, 320),
        locked:arr(repairContext.locked).map((item) => ({ entity:item.entity, dimension:item.dimension, field:item.field })),
        path:arr(repairContext.path).map((name) => text(name, 120))
      };
    }
    log('query_v4_coverage_payload', { step, entity:state.entityName || state.name, dimension, repair:!!repairContext, payload });
    const call = await modelJson(client, model, repairContext ? REPAIR_COVERAGE_SYSTEM : COVERAGE_SYSTEM, payload, { maxTokens:48 });
    addUsage(usage, call.usage);
    const fieldIndex = Number(call.parsed?.field);
    const field = fields.find((item) => item.index === fieldIndex);
    if (field) covered.push({ dimension, field:field.name });
    log('query_v4_coverage_dimension', {
      step,
      entity:state.entityName || state.name,
      dimension,
      field:field?.name || '',
      repair:!!repairContext,
      usage:call.usage,
      cumulativeUsage:{...usage}
    });
  }

  log('query_v4_coverage_model', { step, entity:state.entityName || state.name, covered, repair:!!repairContext, cumulativeUsage:{...usage} });
  return covered;
}

export function coverageState(dimensions, accepted) {
  const covered = new Set();
  for (const item of accepted.values()) for (const dim of arr(item.covered)) covered.add(dim.dimension);
  return { covered:[...covered], missing:dimensions.filter((name) => !covered.has(name)) };
}
