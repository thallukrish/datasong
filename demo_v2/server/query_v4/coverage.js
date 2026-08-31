import { addUsage, arr, key, modelJson, text } from '../query_v2/modelJson.js';

const ENTITY_SYSTEM = `Inspect ONE selected entity as a coherent evidence package for the unresolved analytical requirements. You are given the entity's COMPLETE schema plus ONLY real schema FK edges that LeMap can traverse from this entity. Return JSON only: {"e":[{"dimension":dimensionIndex,"field":"field-or-expression"}],"f":[{"fk":fkIndex,"scores":[{"dimension":dimensionIndex,"score":0.8}]}]}. e = direct evidence available on THIS entity. Evidence may be one real data field or a simple expression composed only from supplied NON-FK data fields (for example quantity * unitAmount). FK/ID fields are navigation handles, not business-attribute values. An FK field may directly satisfy a requirement only when that requirement explicitly asks for the referenced object's identifier or identity. A broader business-facing entity/dimension requirement is NOT satisfied merely because the FK points to an entity with that conceptual name; when the referenced entity can provide the richer business meaning, put that relationship in f and let LeMap traverse it. An FK must NEVER satisfy an attribute of the referenced entity such as region, price, name, category, date, amount, etc. If an FK looks useful for an unresolved concept beyond explicit identity, put that relationship in f so LeMap traverses to the referenced entity and the model inspects that entity's real fields before making a firm evidence decision. Do not invent fields, joins, constants, or business logic. A time requirement needs a supplied real date/time field with the correct event meaning. A monetary measure may be a valid arithmetic expression over supplied non-FK numeric fields when the requested business measure requires it. f = real FK edges worth following because their target entity is promising for one or more STILL unresolved requirements. Use only supplied fkIndex values. Score semantic promise on 1.0 direct/near-certain, .8 strong, .6 good, .4 plausible, .2 weak. Do not follow edges merely for generic connectivity; select them because they can help answer unresolved plan requirements. Omit unsupported evidence and unhelpful FKs. No reasons or extra keys.`;

const REPAIR_ENTITY_SYSTEM = `Inspect ONE repair anchor/entity as a coherent evidence package for the reopened analytical requirements. You are given the entity's COMPLETE schema plus ONLY real FK edges LeMap can traverse, together with the authoritative repair requirement and locked evidence. Return JSON only: {"e":[{"dimension":dimensionIndex,"field":"field-or-expression"}],"f":[{"fk":fkIndex,"scores":[{"dimension":dimensionIndex,"score":0.8}]}]}. e may use one supplied real data field or a simple expression composed only from supplied NON-FK data fields, but it must directly and semantically satisfy the reopened requirement. FK/ID fields are navigation handles and may directly satisfy only a requirement that explicitly asks for the referenced object's identifier or identity. A broader business-facing entity/dimension requirement must traverse the FK so the target entity can provide its richer meaning. FK fields must never be accepted as attributes of the referenced entity. If an FK may lead to the reopened concept beyond explicit identity, return it in f and let LeMap traverse before deciding from the target entity's real fields. Repair context can narrow valid evidence but can never make an invalid primitive field valid. A generic lifecycle timestamp is not transaction/event time unless its meaning matches. Locked evidence must not be reinterpreted or replaced. f may select only supplied real FK edges that are promising for the reopened requirement, scored 1/.8/.6/.4/.2. Do not follow edges merely for connectivity. No reasons or extra keys.`;

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

function numericEntries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value)
    .map(([index, item]) => [Number(index), item])
    .filter(([index]) => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a[0] - b[0]);
}

function descriptiveEvidence(value) {
  return arr(value).map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const dimension = Number(item.dimension);
    if (!Number.isInteger(dimension) || dimension < 0) return null;
    return [dimension, item.field];
  }).filter(Boolean);
}

function descriptiveFollow(value) {
  return arr(value).map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const fk = Number(item.fk);
    if (!Number.isInteger(fk) || fk < 0) return null;
    const scores = arr(item.scores).map((score) => {
      if (!score || typeof score !== 'object' || Array.isArray(score)) return null;
      const dimension = Number(score.dimension);
      const value = Number(score.score);
      if (!Number.isInteger(dimension) || dimension < 0 || !Number.isFinite(value)) return null;
      return [dimension, value];
    }).filter(Boolean);
    return [fk, scores];
  }).filter(Boolean);
}

function normalizeFollowArray(value) {
  return arr(value).map((item) => {
    if (!Array.isArray(item) || item.length < 2) return item;
    const fk = Number(item[0]);
    const rawScores = item[1];
    if (!Number.isInteger(fk) || fk < 0) return item;
    if (rawScores && typeof rawScores === 'object' && !Array.isArray(rawScores) && Array.isArray(rawScores.scores)) {
      return [fk, rawScores.scores];
    }
    return item;
  });
}

export function normalizeCoverageResponse(parsed) {
  const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const evidence = Array.isArray(source.e)
    ? (source.e.some((item) => item && typeof item === 'object' && !Array.isArray(item)) ? descriptiveEvidence(source.e) : source.e)
    : numericEntries(source.e).map(([dimensionIndex, expression]) => [dimensionIndex, expression]);
  const follow = Array.isArray(source.f)
    ? (source.f.some((item) => item && typeof item === 'object' && !Array.isArray(item)) ? descriptiveFollow(source.f) : normalizeFollowArray(source.f))
    : numericEntries(source.f).map(([fkIndex, scores]) => [
        fkIndex,
        numericEntries(scores).map(([dimensionIndex, score]) => [dimensionIndex, Number(score)])
      ]);
  return { e:evidence, f:follow };
}

function fieldNamesInExpression(expression) {
  return String(expression || '').match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
}

function fkTargetsByLocalField(fks) {
  const map = new Map();
  for (const fk of fks) {
    for (const keyMap of arr(fk.keyMaps)) {
      const local = key(keyMap.fieldName);
      if (!local) continue;
      if (!map.has(local)) map.set(local, new Set());
      map.get(local).add(key(fk.target));
    }
  }
  return map;
}

function isIdentityRequirement(dimension, targets) {
  const wanted = key(dimension);
  if (!wanted) return false;
  for (const target of targets || []) {
    if (!target) continue;
    if (wanted === `${target}id` || wanted === `${target}identity`) return true;
  }
  return false;
}

function validEvidenceExpression(expression, fields, dimension, fkFieldTargets) {
  const value = text(expression, 220);
  if (!value) return '';
  const names = new Set(fields.map((field) => key(field.name)));
  const tokens = fieldNamesInExpression(value);
  const operatorsOnly = value.replace(/[A-Za-z_][A-Za-z0-9_]*/g, '').replace(/[\d\s()+\-*/.]/g, '');
  if (operatorsOnly) return '';
  if (!tokens.length || tokens.some((token) => !names.has(key(token)))) return '';

  const fkTokens = tokens.filter((token) => fkFieldTargets.has(key(token)));
  if (fkTokens.length) {
    if (tokens.length !== 1 || fkTokens.length !== 1) return '';
    const targets = fkFieldTargets.get(key(fkTokens[0]));
    if (!isIdentityRequirement(dimension, targets)) return '';
  }
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
  const fkFieldTargets = fkTargetsByLocalField(fks);
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
  const decision = normalizeCoverageResponse(call.parsed);

  log('query_v4_entity_raw_model', {
    step,
    entity:state.entityName || state.name,
    raw:call.raw,
    parsed:call.parsed,
    normalized:decision,
    attempts:call.attempts,
    usage:call.usage,
    cumulativeUsage:{...usage}
  });

  const covered = [];
  const rejectedFkEvidence = [];
  const seenDimensions = new Set();
  for (const item of decision.e) {
    if (!Array.isArray(item)) continue;
    const idx = Number(item[0]);
    const dimension = dimensions[idx];
    if (!dimension || !missingSet.has(key(dimension)) || seenDimensions.has(key(dimension))) continue;
    const rawExpression = text(item[1], 220);
    const expression = validEvidenceExpression(rawExpression, fields, dimension, fkFieldTargets);
    if (!expression) {
      const tokens = fieldNamesInExpression(rawExpression);
      if (tokens.some((token) => fkFieldTargets.has(key(token)))) rejectedFkEvidence.push({ dimension, field:rawExpression });
      continue;
    }
    seenDimensions.add(key(dimension));
    covered.push({ dimension, field:expression });
  }

  const follow = [];
  const seenFk = new Set();
  for (const item of decision.f) {
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
    rejectedFkEvidence,
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
