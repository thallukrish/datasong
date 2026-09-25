import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';

function workflowSummary(workflow, index) {
  return {
    index,
    id:workflow?.id,
    title:text(workflow?.title,160),
    intent:text(workflow?.businessIntent,240),
    trigger:text(workflow?.trigger,180),
    outcome:text(workflow?.businessOutcome || workflow?.outcome,240),
    stages:arr(workflow?.workflowSteps).slice(0,24).map((s,i) => ({
      index:i,
      name:text(s?.name,160),
      description:text(s?.description,260),
      entities:arr(s?.entities).slice(0,8),
      persistentObjects:arr(s?.persistentObjects).slice(0,8),
      effect:text(s?.effect,180)
    })),
    entities:[...new Set([
      ...arr(workflow?.entities),
      ...arr(workflow?.persistentObjects),
      ...arr(workflow?.entityDetails).map(x => x?.name)
    ].filter(Boolean))].slice(0,24)
  };
}

export async function matchCausalEdgeToWorkflows({ edge, nodesById, workflows, client, model, usage, log = () => {} }) {
  const candidates = arr(workflows).map(workflowSummary);
  const system = `You match ONE proposed causal edge to already-learned business workflows. A match is evidence that a workflow contains stages/transitions relevant to testing the edge, not proof that the cause occurred for a particular record.

Return sparse JSON {"matches":[{"workflowIndex":0,"confidence":0.0,"stageIndexes":[0],"role":"short","supports":"what transition is evidenced","gaps":["specific missing transition/entity evidence"]}],"exhausted":false}.
Use confidence 0..1. Prefer workflow continuity and actual stage semantics over shared words/entities. Return at most 4 matches with confidence >= 0.35. If no known workflow plausibly supports the edge, return matches=[] and exhausted=true. Do not invent workflow IDs, stages or entities.`;
  const payload = {
    edge:{
      id:edge.id,
      from:nodesById.get(edge.from)?.label || edge.from,
      to:nodesById.get(edge.to)?.label || edge.to,
      hypothesis:edge.hypothesis,
      evidenceRequired:edge.evidenceRequired
    },
    workflows:candidates
  };
  const call = await modelJson(client, model, system, payload);
  addUsage(usage, call.usage);
  const matches = arr(call.parsed?.matches).map(item => {
    const wf = candidates[Number(item?.workflowIndex)];
    if (!wf) return null;
    return {
      workflowId:wf.id,
      title:wf.title,
      confidence:Math.max(0,Math.min(1,Number(item?.confidence || 0))),
      stageIndexes:arr(item?.stageIndexes).map(Number).filter(Number.isInteger).filter(i => i >= 0 && i < wf.stages.length),
      stages:arr(item?.stageIndexes).map(Number).filter(Number.isInteger).map(i => wf.stages[i]).filter(Boolean),
      role:text(item?.role,180),
      supports:text(item?.supports,300),
      gaps:arr(item?.gaps).map(v => text(v,180)).filter(Boolean).slice(0,8)
    };
  }).filter(Boolean).filter(m => m.confidence >= 0.35).slice(0,4);
  log('query_v5_workflow_match', { edgeId:edge.id, matches, exhausted:!!call.parsed?.exhausted, usage:call.usage });
  return { matches, exhausted:!!call.parsed?.exhausted };
}
