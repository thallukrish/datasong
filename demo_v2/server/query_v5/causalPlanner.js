import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';

const status = (value) => ['hypothesized','workflow_supported','entity_connected','contradicted','unresolved'].includes(value) ? value : 'hypothesized';

function normalizeNode(item, index) {
  return {
    id:text(item?.id || `n${index + 1}`, 60),
    label:text(item?.label, 180),
    kind:text(item?.kind || 'business_state', 60)
  };
}

function normalizeEdge(item, index) {
  return {
    id:text(item?.id || `e${index + 1}`, 60),
    from:text(item?.from, 60),
    to:text(item?.to, 60),
    hypothesis:text(item?.hypothesis, 260),
    evidenceRequired:arr(item?.evidenceRequired).map(v => text(v, 120)).filter(Boolean).slice(0,12),
    required:item?.required !== false,
    status:status(item?.status),
    workflowEvidence:[],
    entityEvidence:[],
    missing:[]
  };
}

export async function planQueryV5({ question, client, model, enterpriseContext = {}, processOverview = [], guidance = '', usage, log = () => {} }) {
  const system = `You design LeMap Query V5 investigations. Classify the request as debugging, retrieval, or mixed.

For debugging: return a candidate CAUSAL GRAPH, not a numbered plan. Nodes are business events/states/observations. Directed edges are causal hypotheses to test. Branches may split or converge and shared events must reuse nodes. Preserve the user's exact observation, scope, named business objects/time period, and any explicit constraints or baselines supplied by the user. Do not assert a hypothesis as fact. Include only causal branches reasonably relevant to answering the question.

Ground the business concepts and plausible causal structure in the user's question together with the supplied enterprise/business description. Do not inject domain-specific concepts that are not supported by that context. The learned process overview is only an orientation to what LeMap currently knows about the enterprise and may be incomplete; it is not evidence that a causal hypothesis is true and it must not constrain the graph to only already-learned workflows.

The actual workflow stages, entities, fields, and relationships that support or contradict this candidate graph will be discovered and presented later by Query V5 from the learned semantic map. Therefore do not choose or invent workflows, entities, tables, fields, or joins during causal planning.

For retrieval: return an ordered retrieval plan centered on business concepts, grain, filters/measures and relationships implied by the question and enterprise description; do not invent a causal graph merely to fit the schema.

For mixed: return both, with the causal graph primary when the question asks why/debug/explain.

Return JSON:
{"mode":"debugging|retrieval|mixed","observation":"what must be explained or retrieved","successCriterion":"when structural exploration may stop","causalGraph":{"nodes":[{"id":"n1","label":"","kind":"observation|event|state|constraint"}],"edges":[{"id":"e1","from":"n1","to":"n2","hypothesis":"","evidenceRequired":[""],"required":true}]},"retrievalPlan":[{"action":"","requires":[""],"relation":""}],"grain":"","notes":""}.
Do not select workflows, entities, tables, fields or joins. The graph is a hypothesis structure for later evidence matching.`;
  const payload = {
    question,
    guidance:text(guidance, 2400),
    enterprise:{ name:text(enterpriseContext?.name,160), description:text(enterpriseContext?.description,3000) },
    learnedProcessOverview:arr(processOverview).slice(0,40).map(w => ({
      id:w?.id, title:text(w?.title,160), intent:text(w?.businessIntent,220), outcome:text(w?.businessOutcome || w?.outcome,220)
    })),
    overviewMayBeIncomplete:true
  };
  const call = await modelJson(client, model, system, payload);
  addUsage(usage, call.usage);
  const nodes = arr(call.parsed?.causalGraph?.nodes).map(normalizeNode).filter(n => n.id && n.label);
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = arr(call.parsed?.causalGraph?.edges).map(normalizeEdge)
    .filter(e => e.id && nodeIds.has(e.from) && nodeIds.has(e.to));
  const plan = {
    mode:['debugging','retrieval','mixed'].includes(call.parsed?.mode) ? call.parsed.mode : 'debugging',
    observation:text(call.parsed?.observation || question, 500),
    successCriterion:text(call.parsed?.successCriterion, 500),
    causalGraph:{ nodes, edges },
    retrievalPlan:arr(call.parsed?.retrievalPlan).slice(0,16).map(item => ({
      action:text(item?.action,220),
      requires:arr(item?.requires).map(v => text(v,100)).filter(Boolean).slice(0,12),
      relation:text(item?.relation,180)
    })).filter(item => item.action),
    grain:text(call.parsed?.grain,180),
    notes:text(call.parsed?.notes,500)
  };
  log('query_v5_plan', { question, plan, usage:call.usage });
  return plan;
}
