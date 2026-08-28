import { addUsage, arr, key, modelJson, text } from '../query_v2/modelJson.js';

const ENTITY_SYSTEM = `Inspect ONE selected entity as a coherent evidence package for the unresolved analytical requirements. You are given the entity's COMPLETE schema plus ONLY real schema FK edges that LeMap can traverse from this entity. Return JSON only: {"e":[[dimensionIndex,"field-or-expression"]],"f":[[fkIndex,[[dimensionIndex,score]]]]}. e = direct evidence available on THIS entity. Evidence may be one field or a simple expression composed only from supplied fields (for example quantity * unitAmount). Do not invent fields, joins, constants, or business logic. IDs may satisfy identity requirements, but an ID is not a date/time, amount, region, etc. A time requirement needs a supplied date/time field with the correct event meaning. A monetary measure may be a valid arithmetic expression over supplied numeric fields when the requested business measure requires it. f = real FK edges worth following because their target entity is promising for one or more STILL unresolved requirements. Use only supplied fkIndex values. Score semantic promise on 1.0 direct/near-certain, .8 strong, .6 good, .4 plausible, .2 weak. Do not follow edges merely for generic connectivity; select them because they can help answer unresolved plan requirements. Omit unsupported evidence and unhelpful FKs. No reasons or extra keys.`;

const REPAIR_ENTITY_SYSTEM = `Inspect ONE repair anchor/entity as a coherent evidence package for the reopened analytical requirements. You are given the COMPLETE schema plus ONLY real FK edges LeMap can traverse, together with the authoritative repair requirement and locked evidence. Return JSON only: {"e":[[dimensionIndex,"field-or-expression"]],"f":[[fkIndex,[[dimensionIndex,score]]]]}. e may use one supplied field or a simple expression composed only from supplied fields, but it must directly and semantically satisfy the reopened requirement. Repair context can narrow valid evidence but can never make an invalid primitive field valid: IDs are not dates/times or monetary measures; a generic lifecycle timestamp is not transaction/event time unless its meaning matches. Locked evidence must not be reinterpreted or replaced. f may select only supplied real FK edges that are promising for the reopened requirement, scored 1/.8/.6/.4/.2. Do not follow edges merely for connectivity. No reasons or extra keys.`;

function completeFields(state) {
  return arr(state?.schemaFields).map((field, index) => ({
    index,
    name:text(field?.name, 120),
    type:text(field?.type, 60),
    isPk:!!field?.isPk,
    description:text(field?.description, 180)
  })).filter((field) => field.name);
}

function compactFk(state, index) {
  const join = state?.edge?.join || {};
  return {
    index,
    target:state?.entityName || state?.name || '',
    relationship:text(join.relationship, 120),
    cardinality:text(join.cardinality, 80),
    keyMaps:arr(join.keyMaps).map((m) => ({
      fieldName:text(m?.fieldName, 120),
      relatedFieldName:text(m?.relatedFieldName, 120)
    }))
  };
}

function fieldNamesInExpression(expression) {
  return String(expression || '').match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
}

function validEvidenceExpression(expression, fields) {
  const value = text(expression, 220);
  if (!value) return '';
  const names = new Set(fields.map((field) => key(field.name)));
  const tokens = fieldNamesInExpression(value);
  const operatorsOnly = value.replace(/[A-Za-z_][A-Za-z0-9_]*/g, '').replace(/[\d\s()+\-*/.]/g, '');
  if (operatorsOnly) return '';
  if (!tokens.length || tokens.some((token) => !names.has(key(token)))) return '';
  return value;
}

function scoreVector(dimensions, pairs) {
  const score = {};
  for (const pair of arr(pairs)) {
    if (!Array.isArray(pair)) continue;
    const idx = Number(pair[0]);
    const value = Number(pair[1]);
    const dimension = dimensions[idx];
    if (!dimension || !Number.isFinite(value)) continue;
    score[dimension] = Math.max(0, Math.min(1, value));
  }
  return score;
}

export async function evaluateEntityCoverage({
  state,
  dimensions,
  missingDimensions,
  fkCandidates = [],
  intent = '',
  client,
  model,
  usage,
  log,
  step,
  repairContext = null
}) {
  if (state?.type !== 'entity' || !state?.evidence) return { covered:[], follow:[] };
  const fields = completeFields(state);
  if (!fields.length) {
    log('query_v4_entity_model', { step, entity:state.entityName || state.name, covered:[], follow:[], skipped:'no-schema-fields', repair:!!repairContext, cumulativeUsage:{...usage} });
    return { covered:[], follow:[] };
  }

  const missingSet = new Set(missingDimensions.map(key));
  const unresolved = dimensions.map((name, index) => missingSet.has(key(name)) ? [index, name] : null).filter(Boolean);
  const fks = fkCandidates.map(compactFk);
  const payload = {
    intent:text(intent, 900),
    unresolved,
    entity:{
      name:state.evidence?.entity?.name || state.entityName || state.name,
      description:text(state.evidence?.entity?.description, 260)
    },
    fields:fields.map((field) => [field.index, field.name, field.type, field.isPk ? 1 : 0, field.description]),
    fks:fks.map((fk) => [fk.index, fk.target, fk.relationship, fk.cardinality, fk.keyMaps])
  };
  if (repairContext) {
    payload.repair = {
      requirement:text(repairContext.requirement, 420),
      locked:arr(repairContext.locked).map((item) => ({ entity:item.entity, dimension:item.dimension, field:item.field })),
      path:arr(repairContext.path).map((name) => text(name, 120))
    };
  }

  log('query_v4_entity_payload', {
    step,
    entity:state.entityName || state.name,
    repair:!!repairContext,
    fullSchema:true,
    fieldCount:fields.length,
    fkCount:fks.length,
    payload
  });
  const call = await modelJson(client, model, repairContext ? REPAIR_ENTITY_SYSTEM : ENTITY_SYSTEM, payload, { maxTokens:420 });
  addUsage(usage, call.usage);

  const covered = [];
  const seenDimensions = new Set();
  for (const item of arr(call.parsed?.e)) {
    if (!Array.isArray(item)) continue;
    const idx = Number(item[0]);
    const dimension = dimensions[idx];
    if (!dimension || !missingSet.has(key(dimension)) || seenDimensions.has(key(dimension))) continue;
    const expression = validEvidenceExpression(item[1], fields);
    if (!expression) continue;
    seenDimensions.add(key(dimension));
    covered.push({ dimension, field:expression });
  }

  const follow = [];
  const seenFk = new Set();
  for (const item of arr(call.parsed?.f)) {
    if (!Array.isArray(item)) continue;
    const idx = Number(item[0]);
    const stateCandidate = fkCandidates[idx];
    if (!stateCandidate || seenFk.has(idx)) continue;
    const score = scoreVector(dimensions, item[1]);
    if (!Object.keys(score).some((name) => missingSet.has(key(name)))) continue;
    seenFk.add(idx);
    follow.push({ state:stateCandidate, score });
  }

  log('query_v4_entity_model', {
    step,
    entity:state.entityName || state.name,
    covered,
    follow:follow.map((item) => ({ entity:item.state.entityName || item.state.name, score:item.score })),
    repair:!!repairContext,
    fullSchema:true,
    fieldCount:fields.length,
    fkCount:fks.length,
    usage:call.usage,
    cumulativeUsage:{...usage}
  });
  return { covered, follow };
}

export function coverageState(dimensions, accepted) {
  const covered = new Set();
  for (const item of accepted.values()) for (const dim of arr(item.covered)) covered.add(dim.dimension);
  return { covered:[...covered], missing:dimensions.filter((name) => !covered.has(name)) };
}
