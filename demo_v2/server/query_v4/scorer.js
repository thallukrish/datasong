import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';
import { compactVector, scoreVector } from '../query_v3/pathScore.js';

const PATH_SYSTEM = `Score candidate RESULTING PATHS against the ORDERED ANSWER PLAN in the supplied intent context. The answer-plan steps are provisional investigation hypotheses, not evidence; dimensions are searchable concepts needed to test them. Score candidate paths for their ability to investigate the ORIGINAL QUESTION, and do not treat an easy metric as a substitute for the requested causal explanation. Prefer candidates that advance the earliest unresolved analytical step while preserving already-supported prior steps. Workflow, cluster, topic, entity, workflow-member entity, and schema-linked entity are all simply candidate states. A workflow is a learned business-process hypothesis: score it by how strongly it appears to implement one or more answer-plan steps, especially a coherent contiguous portion of the early unresolved plan. Do not require one workflow to implement the whole plan. Directory seeds remain valid alternatives when they better advance the plan.

Score the accumulated path for each supplied concept, but use the answer-plan relationships/grain to decide whether apparent concept support is actually useful. A generic field that matches a concept but does not participate in the required step should score lower than evidence that completes the required relationship. Example: when the step is to associate a sales observation with transaction time, a product introduction date should not strengthen transaction_time; an order/event time attached to the same sale should. Likewise, product or region evidence should be associated with the same sale/observation grain when the plan requires that.

Do not score hypothetical future reachability beyond the supplied candidate. Preserve a prior score only when the accumulated path still supports it; raise it when the new state adds evidence or advances a required answer-plan step; lower it when the path becomes less analytically coherent. Use 1.0=direct/near-certain, 0.8=strong, 0.6=good, 0.4=plausible, 0.2=weak, 0=no support. Avoid 1.0 unless warranted. Return JSON only: {"c":[[candidateIndex,[[dimensionIndex,score]]]],"r":[candidateIndex]}. Return AT MOST 5 candidates, prioritizing paths that best advance the earliest unresolved plan steps. Return SPARSE score vectors: include only meaningful nonzero support for at most 5 of the most relevant dimensions per candidate. Omit weak 0.2 scores and all zero scores; absent dimensions mean no supported evidence, not an invitation to invent support. If an accumulated path already supports a dimension, include its prior score only when still directly relevant to the unresolved plan. Never enumerate every dimension for every candidate. Omitted candidates remain eligible but unscored. r means explicitly irrelevant from supplied evidence, not merely weak. No names, reasons, or extra keys.`;

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
    i:text(intent, 1400),
    d:dimensions.map((name, index) => [index, name]),
    u:dimensions.map((name, index) => missing.has(name) ? index : null).filter((v) => v !== null),
    p:path?.states?.map((state) => state.name) || [],
    s:compactVector(path?.score || {}, dimensions),
    o:rows
  };
  log('query_v4_score_payload', { step, payload });
  const call = await modelJson(client, model, PATH_SYSTEM, payload, { maxTokens:1100 });
  addUsage(usage, call.usage);

  const rejected = new Set(arr(call.parsed?.r).map(String));
  const cutoff = Math.max(0, Math.min(1, Number(process.env.LEMAP_QUERY_RELEVANCE_CUTOFF ?? 0.3)));
  const thresholdRejected = [];
  const used = new Set();
  const scored = [];
  for (const item of arr(call.parsed?.c)) {
    if (!Array.isArray(item)) continue;
    const idx = String(item[0]);
    const state = byIndex.get(idx);
    if (!state || rejected.has(idx)) continue;
    used.add(idx);
    const score = scoreVector(dimensions, item[1]);
    const unresolvedScores = missingDimensions.map((name) => Number(score[name] || 0));
    const best = unresolvedScores.length ? Math.max(...unresolvedScores) : 0;
    // Schema-FK candidates may be essential bridges between otherwise relevant entities.
    // Retain them for the deterministic connectivity check even without direct dimension support.
    const isConnector = state?.edge?.kind === 'schema_fk';
    if (best < cutoff && !isConnector) {
      thresholdRejected.push({ state:state.name, type:state.type, best, cutoff });
      continue;
    }
    scored.push({ state, score });
  }
  const omitted = candidates.filter((_state, index) => !used.has(String(index)) && !rejected.has(String(index)));
  log('query_v4_score_model', {
    step,
    scored:scored.map((item) => ({ state:item.state.name, type:item.state.type, score:item.score })),
    omitted:omitted.map((state) => state.name),
    rejected:[...rejected],
    thresholdRejected,
    relevanceCutoff:cutoff,
    usage:call.usage,
    cumulativeUsage:{...usage}
  });
  return { scored, omitted, rejected, thresholdRejected, usage:call.usage };
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

function stepText(step, index) {
  const action = text(step?.action, 180);
  const requires = arr(step?.requires).map((v) => text(v, 80)).filter(Boolean);
  const relation = text(step?.relation, 180);
  if (!action) return '';
  return `${index + 1}. ${action}${requires.length ? ` [needs ${requires.join(', ')}]` : ''}${relation ? ` [${relation}]` : ''}`;
}

function canonicalConcept(value) {
  return text(value, 80).trim();
}

function addConcept(map, name, role = 'attribute') {
  const clean = canonicalConcept(name);
  if (!clean) return;
  const k = clean.toLowerCase();
  if (!map.has(k)) map.set(k, { name:clean, role:text(role, 24) || 'attribute' });
}

export async function deriveDimensions({ question, client, model, usage, log, enterpriseContext = {}, processOverview = [], planningGuidance = '' }) {
  const system = `You are investigating an enterprise as a curious business-process debugger, not simply generating a report. The enterprise may operate in manufacturing, services, finance, or another domain. Use the supplied enterprise description and learned process overview to orient your investigation, without assuming the overview is complete or correct. Distinguish the user's question from a superficially similar metric; in particular, demand, available capacity, planned capacity, and actual output are not interchangeable.

First identify the question's intent (description, calculation, comparison, causal explanation, or mixed). Translate it into an ORDERED, PROVISIONAL INVESTIGATION PLAN that actually answers the original question. For a "why" or troubleshooting question, establish the observed outcome and scope, formulate plausible competing explanations in relevant upstream/downstream business processes, and specify what business evidence would distinguish them. Follow handoffs and dependencies across processes rather than assuming the answer lies in a single entity. Do not assert that a hypothesis is true before evidence is found. If the question names specific orders, preserve their identity and the applicable period; do not silently turn order demand into available capacity. Include a step to reassess hypotheses when new evidence contradicts the initial plan.

Return {"intent":"short","steps":[{"action":"semantic investigation step","requires":["canonical concept"],"relation":"optional relationship to establish"}],"dimensions":[{"name":"canonical concept","role":"measure|dimension|time|filter|attribute|derived"}],"relations":[{"from":"concept-or-grain","relation":"short semantic relationship","to":"concept-or-grain"}],"derived":[{"name":"derived result","expression":"short analytical expression","dependsOn":["canonical concept"]}],"grain":"short description of the observation grain"}.

Steps describe WHAT must be established, not implementation details. For a calculation, include its correct inputs and grain; for a causal question, include the relevant outcomes, candidate constraints, process evidence, and the comparison needed to test explanations. Every base concept referenced by a step, relation, or derived dependency must be represented as a searchable concept. Do not choose workflows, states, entities, clusters, fields, or joins. The initial plan guides discovery and may need revision; it is not evidence that a cause exists. If the user provided additional investigation guidance, incorporate it into the plan without silently changing or replacing the original question.`;
  const context = {
    question,
    userInvestigationGuidance:text(planningGuidance, 2000),
    enterprise:{
      name:text(enterpriseContext?.name, 160),
      description:text(enterpriseContext?.description, 3000)
    },
    learnedProcessOverview:arr(processOverview).slice(0, 40),
    overviewIsIncomplete:true
  };
  log('query_v4_planning_context', { enterprise:context.enterprise, learnedProcessOverview:context.learnedProcessOverview });
  const call = await modelJson(client, model, system, context, { maxTokens:1200 });
  addUsage(usage, call.usage);

  const rawDimensions = arr(call.parsed?.dimensions).slice(0, 16)
    .map((item) => ({ name:canonicalConcept(item?.name), role:text(item?.role, 24) }))
    .filter((item) => item.name);
  const relations = arr(call.parsed?.relations).slice(0, 16)
    .map((item) => ({ from:canonicalConcept(item?.from), relation:text(item?.relation, 80), to:canonicalConcept(item?.to) }))
    .filter((item) => item.from && item.relation && item.to);
  const rawDerived = arr(call.parsed?.derived).slice(0, 10)
    .map((item) => ({
      name:canonicalConcept(item?.name),
      expression:text(item?.expression, 180),
      dependsOn:arr(item?.dependsOn).map(canonicalConcept).filter(Boolean).slice(0, 10)
    }))
    .filter((item) => item.name);
  const steps = arr(call.parsed?.steps).slice(0, 12)
    .map((item) => ({
      action:text(item?.action, 200),
      requires:arr(item?.requires).map(canonicalConcept).filter(Boolean).slice(0, 10),
      relation:text(item?.relation, 200)
    }))
    .filter((item) => item.action);

  // Requirement closure: searchable concepts are derived from the provisional plan,
  // not trusted solely from a separately returned dimensions list.
  const conceptMap = new Map();
  for (const item of rawDimensions) addConcept(conceptMap, item.name, item.role);
  for (const step of steps) for (const name of step.requires) addConcept(conceptMap, name);
  for (const rel of relations) {
    addConcept(conceptMap, rel.from);
    addConcept(conceptMap, rel.to);
  }
  for (const item of rawDerived) for (const name of item.dependsOn) addConcept(conceptMap, name);

  const derivedNames = new Set(rawDerived.map((item) => item.name.toLowerCase()));
  const dimensions = [...conceptMap.values()]
    .filter((item) => !derivedNames.has(item.name.toLowerCase()))
    .slice(0, 16);
  const searchableKeys = new Set(dimensions.map((item) => item.name.toLowerCase()));
  const derived = rawDerived.map((item) => ({
    ...item,
    dependsOn:item.dependsOn.filter((v) => searchableKeys.has(v.toLowerCase()))
  }));

  const grain = text(call.parsed?.grain, 180);
  const baseIntent = text(call.parsed?.intent, 180);
  const stepSummary = steps.map(stepText).filter(Boolean).join(' | ');
  const relationSummary = relations.map(relationText).filter(Boolean).join('; ');
  const derivedSummary = derived.map(derivedText).filter(Boolean).join('; ');
  const scoringIntent = [
    `ORIGINAL QUESTION: ${text(question, 500)}`,
    baseIntent,
    stepSummary ? `INVESTIGATION PLAN: ${stepSummary}` : '',
    grain ? `required grain: ${grain}` : '',
    relationSummary ? `required relationships: ${relationSummary}` : '',
    derivedSummary ? `derived: ${derivedSummary}` : ''
  ].filter(Boolean).join(' | ');

  const logicalRequest = {
    intent:scoringIntent,
    baseIntent,
    steps,
    dimensions,
    relations,
    derived,
    grain
  };
  log('query_v4_dimensions', { question, logicalRequest, usage:call.usage, cumulativeUsage:{...usage} });
  return logicalRequest;
}
