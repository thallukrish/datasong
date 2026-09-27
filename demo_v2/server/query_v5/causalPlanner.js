import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';

const status = (value) => ['hypothesized','workflow_supported','entity_connected','contradicted','unresolved'].includes(value) ? value : 'hypothesized';

function normalizeNode(item, index) {
  return {
    id:text(item?.id || `n${index + 1}`, 60),
    label:text(item?.label, 180),
    kind:text(item?.kind || 'business_state', 60)
  };
}

function normalizePriority(value) {
  const v=String(value||'').toLowerCase();
  return ['high','medium','low'].includes(v)?v:'medium';
}

function normalizeEdge(item, index) {
  const level=Math.max(1,Math.min(3,Number(item?.level||1)));
  return {
    id:text(item?.id || `e${index + 1}`, 60),
    from:text(item?.from, 60),
    to:text(item?.to, 60),
    hypothesis:text(item?.hypothesis, 260),
    evidenceRequired:arr(item?.evidenceRequired).map(v => text(v, 120)).filter(Boolean).slice(0,12),
    priority:normalizePriority(item?.priority),
    investigationOrder:Math.max(1,Number(item?.investigationOrder||index+1)),
    level,
    parentHypothesisId:text(item?.parentHypothesisId,60),
    active:item?.active !== false && level===1,
    required:item?.required !== false && level===1,
    status:status(item?.status),
    workflowEvidence:[],
    entityEvidence:[],
    missing:[]
  };
}

export async function planQueryV5({ question, client, model, enterpriseContext = {}, frameworkContext = {}, learnedGrounding = {}, processOverview = [], guidance = '', usage, log = () => {} }) {
  const system = `You design LeMap Query V5 investigations. Classify the request as debugging, retrieval, or mixed.

For debugging: return a candidate CAUSAL GRAPH, not a flat list of every plausible cause. Nodes are business events/states/observations. Directed edges are causal hypotheses to test. Branches may split or converge and shared events must reuse nodes. Preserve the user's exact observation, scope, named business objects/time period, and any explicit constraints or baselines supplied by the user. Do not assert a hypothesis as fact.

Separate PRECONDITIONS from causal hypotheses. A precondition is something that must be true for the user's question or comparison to be meaningful, but which the user did not explicitly establish. For example, if full capacity can only be used when released demand is at least the stated capacity, express that as a precondition to verify rather than silently treating it as fact.

For the causal graph, produce a small first investigation layer of the most important broad hypotheses, normally 3 to 5. Rank those primary hypotheses by investigation priority using high, medium, or low plus investigationOrder. Put narrower mechanisms under the relevant primary hypothesis as level-2 child hypotheses. Do not promote every detailed framework-specific mechanism to a primary branch. Child hypotheses are dormant initially and should have active=false and required=false. Primary level-1 hypotheses should have active=true and required=true.

Prefer hypotheses whose resolution would eliminate or substantially narrow whole groups of downstream causes. The initial investigation should test broad discriminating branches before detailed mechanisms.

Ground the business concepts and plausible causal structure in four layers:
1. the user's question and explicit constraints/baselines,
2. the supplied enterprise/business description,
3. the supplied application framework context, which is a FRAMEWORK PRIOR about canonical concepts and workflow patterns that may exist,
4. the learned grounding from LeMap's semantic map, which is ENTERPRISE-SPECIFIC OBSERVED ORIENTATION but may be incomplete.

You may use relevant canonical concepts from the named framework when they are useful to the causal hypothesis, even when LeMap has not yet learned them. Treat those as plausible framework-informed hypotheses, not as observed enterprise evidence.

The learned core workflows and entities should ground terminology and show what LeMap has already observed as important in this enterprise. They are not proof that a causal hypothesis is true, they are not exhaustive, and they must not constrain the graph to only already-learned concepts.

The learned process overview is additional orientation to what LeMap currently knows and may also be incomplete.

The actual workflow stages, entities, fields, relationships, and implementation paths that support or contradict this candidate graph will be discovered later by Query V5 from the learned semantic map. During causal planning, form business causal concepts/states rather than selecting implementation tables, joins, or exact workflow paths.

For retrieval: return an ordered retrieval plan centered on business concepts, grain, filters/measures and relationships implied by the question and enterprise description; do not invent a causal graph merely to fit the schema.

For mixed: return both, with the causal graph primary when the question asks why/debug/explain.

Return JSON:
{"mode":"debugging|retrieval|mixed","observation":"what must be explained or retrieved","successCriterion":"when structural exploration may stop","preconditions":[{"id":"p1","statement":"","whyRequired":"","evidenceRequired":[""]}],"causalGraph":{"nodes":[{"id":"n1","label":"","kind":"observation|event|state|constraint"}],"edges":[{"id":"e1","from":"n1","to":"n2","hypothesis":"","evidenceRequired":[""],"priority":"high|medium|low","investigationOrder":1,"level":1,"parentHypothesisId":"","active":true,"required":true}]},"retrievalPlan":[{"action":"","requires":[""],"relation":""}],"grain":"","notes":""}.
Use level=1 for broad primary hypotheses and level=2 for narrower child mechanisms. Child hypotheses must reference their parentHypothesisId and be active=false, required=false.
Do not select implementation tables, fields or joins. Framework entity names may appear only when they help describe a business concept, not as proof. The graph is a hypothesis structure for later evidence matching.`;
  const payload = {
    question,
    guidance:text(guidance, 2400),
    enterprise:{ name:text(enterpriseContext?.name,160), description:text(enterpriseContext?.description,3000) },
    framework:{
      name:text(frameworkContext?.name,120),
      version:text(frameworkContext?.version,60),
      projectAddons:arr(frameworkContext?.projectAddons).map(v=>text(v,100)).filter(Boolean).slice(0,30),
      modules:arr(frameworkContext?.modules).map(v=>text(v,100)).filter(Boolean).slice(0,40),
      source:text(frameworkContext?.source,120)
    },
    learnedGrounding:{
      coreWorkflows:arr(learnedGrounding?.coreWorkflows).slice(0,12).map(w=>({
        id:text(w?.id,100), title:text(w?.title,180), functionalRole:text(w?.functionalRole,40),
        confidence:Number(w?.functionalRoleConfidence||0), intent:text(w?.intent,220), outcome:text(w?.outcome,220)
      })),
      coreEntities:arr(learnedGrounding?.coreEntities).slice(0,15).map(e=>({
        name:text(e?.name,160), role:text(e?.role,40), coreScore:Number(e?.coreScore||0),
        coreWorkflowCount:Number(e?.coreWorkflowCount||0), supportingWorkflowCount:Number(e?.supportingWorkflowCount||0),
        description:text(e?.description,220)
      })),
      mapMayBeIncomplete:true
    },
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
    preconditions:arr(call.parsed?.preconditions).slice(0,8).map((item,index)=>({
      id:text(item?.id||`p${index+1}`,60),
      statement:text(item?.statement,320),
      whyRequired:text(item?.whyRequired,320),
      evidenceRequired:arr(item?.evidenceRequired).map(v=>text(v,120)).filter(Boolean).slice(0,10)
    })).filter(item=>item.statement),
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
