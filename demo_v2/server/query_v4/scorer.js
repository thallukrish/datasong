import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';
import { compactVector, scoreVector } from '../query_v3/pathScore.js';

const PATH_SYSTEM = `Score candidate RESULTING PATHS against the query dimensions AND the analytical relationships described in the supplied intent context. The current path and its existing dimension score are supplied, plus candidate next states. A candidate may be a workflow, cluster, topic, entity, workflow-member entity, or schema-linked entity; treat all simply as states. A workflow is a learned business process whose supplied description summarizes business intent/outcome; it is a semantic starting hypothesis, not proof that every query dimension is present. Score the strength of evidence that THIS accumulated path currently provides for each dimension, but prefer paths where the dimensions participate in the REQUIRED analytical relationships/grain. A generic field that matches a dimension but is unrelated to the already-supported measure/grain should score lower than a field/path that completes a required relationship. For example, if sales_amount must be observed over transaction_time, a product introduction date should not strengthen time merely because it is a date; prefer transaction/order time connected to the sales grain. Likewise prefer product/region evidence associated with the same sale/measure grain rather than unrelated identifiers. Do not score hypothetical future reachability beyond the supplied candidate. Preserve a prior score only when the accumulated path still supports it; raise it only when the new state adds evidence or strengthens a required relationship; lower it when the path becomes less analytically coherent. Use a graded scale: 1.0=direct or near-certain support, 0.8=strong, 0.6=good, 0.4=plausible, 0.2=weak, 0=no support. Avoid 1.0 unless the supplied path/evidence genuinely warrants it. Return JSON only: {"c":[[candidateIndex,[[dimensionIndex,score]]]],"r":[candidateIndex]}. Return AT MOST 8 candidates, prioritizing the strongest resulting paths for dimensions still missing AND required relationships still incomplete. Omitted candidates remain eligible but unscored. r means explicitly irrelevant from supplied evidence, not merely weak. No names, reasons, or extra keys.`;

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
  if (edge.kind !== 'schema_fk') return { kind:edge.kind || 'hierarchy', source:edge.source || '', workflowId:edge.workflowId || '' };
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
    return [index, state.name, state.type, text(state.description, 160), compactEdge(state.edge), compactEvidence(state)];
  });
  const missing = new Set(missingDimensions);
  const payload = {
    i:text(intent, 700),
    d:dimensions.map((name, index) => [index, name]),
    u:dimensions.map((name, index) => missing.has(name) ? index : null).filter((v) => v !== null),
    p:path?.states?.map((state) => state.name) || [],
    s:compactVector(path?.score || {}, dimensions),
    o:rows
  };
  log('query_v4_score_payload', { step, payload });
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
  log('query_v4_score_model', {
    step,
    scored:scored.map((item) => ({ state:item.state.name, type:item.state.type, score:item.score })),
    omitted:omitted.map((state) => state.name),
    rejected:[...rejected],
    usage:call.usage,
    cumulativeUsage:{...usage}
  });
  return { scored, omitted, rejected, usage:call.usage };
}

function relationText(rel) {
  const from = text(rel?.from, 80);
  const relation = text(rel?.relation, 80);
  const to = text(rel?.to, 80);
  if (!from || !relation || !to) return '';
  return `${from} ${relation} ${to}`;
}

function derivedText(item) {
  const name = text(item?.name, 80);
  const expression = text(item?.expression, 180);
  const dependsOn = arr(item?.dependsOn).map((v) => text(v, 80)).filter(Boolean);
  if (!name) return '';
  return `${name}${expression ? ` = ${expression}` : ''}${dependsOn.length ? ` [depends on ${dependsOn.join(', ')}]` : ''}`;
}

export async function deriveDimensions({ question, client, model, usage, log }) {
  const system = `Translate the query into a compact analytical requirement graph. Identify stable business dimensions/measures/time/filter concepts, the relationships that MUST hold among them for the requested result to be computable, and any derived calculation/ranking. Do not choose workflows, states, entities, clusters, fields, or joins. Return {"intent":"short","dimensions":[{"name":"canonical concept","role":"measure|dimension|time|filter|attribute|derived"}],"relations":[{"from":"dimension-or-grain","relation":"short semantic relationship","to":"dimension-or-grain"}],"derived":[{"name":"derived result","expression":"short analytical expression","dependsOn":["dimension"]}],"grain":"short description of the observation grain"}. Relations should express analytical dependence, not implementation joins. Example: sales_amount observed_over transaction_time; sales_amount belongs_to product; sale occurs_in region. Use transaction/event time rather than a generic time concept when the query requires change over time.`;
  const call = await modelJson(client, model, system, { question }, { maxTokens:520 });
  addUsage(usage, call.usage);

  const dimensions = arr(call.parsed?.dimensions).slice(0, 12)
    .map((item) => ({ name:text(item?.name, 80), role:text(item?.role, 24) }))
    .filter((item) => item.name);
  const dimensionKeys = new Set(dimensions.map((item) => item.name.toLowerCase()));
  const relations = arr(call.parsed?.relations).slice(0, 12)
    .map((item) => ({ from:text(item?.from, 80), relation:text(item?.relation, 80), to:text(item?.to, 80) }))
    .filter((item) => item.from && item.relation && item.to);
  const derived = arr(call.parsed?.derived).slice(0, 8)
    .map((item) => ({
      name:text(item?.name, 80),
      expression:text(item?.expression, 180),
      dependsOn:arr(item?.dependsOn).map((v) => text(v, 80)).filter((v) => dimensionKeys.has(v.toLowerCase())).slice(0, 8)
    }))
    .filter((item) => item.name);
  const grain = text(call.parsed?.grain, 180);
  const baseIntent = text(call.parsed?.intent, 180);
  const relationSummary = relations.map(relationText).filter(Boolean).join('; ');
  const derivedSummary = derived.map(derivedText).filter(Boolean).join('; ');
  const scoringIntent = [
    baseIntent,
    grain ? `required grain: ${grain}` : '',
    relationSummary ? `required relationships: ${relationSummary}` : '',
    derivedSummary ? `derived: ${derivedSummary}` : ''
  ].filter(Boolean).join(' | ');

  const logicalRequest = {
    intent:scoringIntent,
    baseIntent,
    dimensions,
    relations,
    derived,
    grain
  };
  log('query_v4_dimensions', { question, logicalRequest, usage:call.usage, cumulativeUsage:{...usage} });
  return logicalRequest;
}
