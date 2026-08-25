import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';
import { compactVector, scoreVector } from './pathScore.js';

const PATH_SYSTEM = `Score candidate RESULTING PATHS against the query dimensions. The current path and its existing dimension score are supplied, plus candidate next states. A candidate may be a cluster, topic, entity, or schema-linked entity; treat all simply as states. Score the strength of evidence that THIS accumulated path currently provides for each dimension. Do not score hypothetical future reachability beyond the supplied candidate. Preserve a prior score only when the accumulated path still supports it; raise it only when the new state adds evidence; lower it when the path becomes less convincing. Use a graded scale: 1.0=direct or near-certain support, 0.8=strong, 0.6=good, 0.4=plausible, 0.2=weak, 0=no support. Avoid 1.0 unless the supplied path/evidence genuinely warrants it. Return JSON only: {"c":[[candidateIndex,[[dimensionIndex,score]]]],"r":[candidateIndex]}. Return AT MOST 8 candidates, prioritizing the strongest resulting paths for dimensions still missing. Omitted candidates remain eligible but unscored. r means explicitly irrelevant from supplied evidence, not merely weak. No names, reasons, or extra keys.`;

function compactEvidence(state) {
  const evidence = state?.evidence;
  if (!evidence) return null;
  return {
    entity:evidence.entity,
    fields:arr(evidence.semanticFields).slice(0, 5).map((item) => [item.field, item.term, item.description])
  };
}

function compactEdge(edge) {
  if (!edge) return null;
  if (edge.kind !== 'schema_fk') return { kind:edge.kind || 'hierarchy' };
  const join = edge.join || {};
  return {
    kind:'schema_fk',
    from:join.from,
    to:join.to,
    relationship:join.relationship,
    keyMaps:arr(join.keyMaps)
  };
}

export async function scoreNextStates({ intent, dimensions, missingDimensions, path, candidates, client, model, usage, log, step }) {
  const byIndex = new Map();
  const rows = candidates.map((state, index) => {
    byIndex.set(String(index), state);
    return [index, state.name, state.type, text(state.description, 120), compactEdge(state.edge), compactEvidence(state)];
  });
  const missing = new Set(missingDimensions);
  const payload = {
    i:text(intent, 140),
    d:dimensions.map((name, index) => [index, name]),
    u:dimensions.map((name, index) => missing.has(name) ? index : null).filter((v) => v !== null),
    p:path?.states?.map((state) => state.name) || [],
    s:compactVector(path?.score || {}, dimensions),
    o:rows
  };
  log('query_v3_score_payload', { step, payload });
  const call = await modelJson(client, model, PATH_SYSTEM, payload, { maxTokens:420 });
  addUsage(usage, call.usage);

  const rejected = new Set(arr(call.parsed?.r).map(String));
  const used = new Set();
  const scored = [];
  for (const item of arr(call.parsed?.c)) {
    if (!Array.isArray(item)) continue;
    const idx = String(item[0]);
    const state = byIndex.get(idx);
    if (!state || rejected.has(idx)) continue;
    used.add(idx);
    scored.push({ state, score:scoreVector(dimensions, item[1]) });
  }
  const omitted = candidates.filter((_state, index) => !used.has(String(index)) && !rejected.has(String(index)));
  log('query_v3_score_model', {
    step,
    scored:scored.map((item) => ({ state:item.state.name, score:item.score })),
    omitted:omitted.map((state) => state.name),
    rejected:[...rejected],
    usage:call.usage,
    cumulativeUsage:{...usage}
  });
  return { scored, omitted, rejected, usage:call.usage };
}

export async function deriveDimensions({ question, client, model, usage, log }) {
  const system = 'Identify stable business dimensions/measures/time/filter concepts required to answer the query. Return {"intent":"short","dimensions":[{"name":"canonical concept","role":"measure|dimension|time|filter|attribute|derived"}]}. Do not choose states, entities, clusters, fields, or joins.';
  const call = await modelJson(client, model, system, { question }, { maxTokens:320 });
  addUsage(usage, call.usage);
  const logicalRequest = {
    intent:text(call.parsed?.intent, 140),
    dimensions:arr(call.parsed?.dimensions).slice(0, 12).map((item) => ({ name:text(item?.name, 80), role:text(item?.role, 24) })).filter((item) => item.name)
  };
  log('query_v3_dimensions', { question, logicalRequest, usage:call.usage, cumulativeUsage:{...usage} });
  return logicalRequest;
}
