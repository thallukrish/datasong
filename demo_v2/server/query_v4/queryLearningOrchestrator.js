// Coordinates query outcomes with a separately supplied, authorized targeted learner.
// No automatic scenario execution is claimed or attempted unless a real learner is registered.
const arr = value => Array.isArray(value) ? value : [];
export function createQueryLearningOrchestrator({runQuery, learnTargeted, log = () => {}, maxCycles = 1}) {
  if (typeof runQuery !== 'function') throw new TypeError('runQuery callback required');
  return async function run({question, context = {}, autoLearn = false}) {
    let response = await runQuery({question, context});
    if (response?.status !== 'needs_learning' || !autoLearn) return response;
    if (typeof learnTargeted !== 'function') {
      log('query_learning_unavailable',{reason:'No targeted adapter/indexing/Pass 1/2 learner registered'});
      return {...response,learningState:'awaiting_learner'};
    }
    const attempts = new Set();
    for (let cycle = 0; cycle < Math.max(0,Math.min(3,maxCycles)); cycle++) {
      const request = response?.learningRequest;
      if (!request || !arr(request.targets).length) break;
      const signature = JSON.stringify(request.targets.map(t=>[t.stepId,t.missingConcepts,t.requiredRelation,t.needsConnectivity]));
      if (attempts.has(signature)) {
        log('query_learning_no_progress',{cycle,signature});
        return {...response,learningState:'no_progress'};
      }
      attempts.add(signature);
      log('query_learning_handoff',{cycle,request});
      // The adapter learner must validate scenarios and report a persisted map change.
      const result = await learnTargeted({request,context,cycle});
      log('query_learning_result',{cycle,changed:result?.changed === true, evidenceRefs:arr(result?.evidenceRefs).slice(0,24)});
      if (result?.changed !== true) return {...response,learningState:'no_new_evidence'};
      response = await runQuery({question,context,plan:request.plan,refreshMap:true});
      if (response?.status !== 'needs_learning') return response;
    }
    return {...response,learningState:'budget_exhausted'};
  };
}
