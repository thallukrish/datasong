// Deterministic, bounded query-to-learning assessment. Model ranking proposes evidence;
// only accepted fields and evidenced graph joins may establish a requirement.
const arr = value => Array.isArray(value) ? value : [];
const norm = value => String(value || '').trim().toLowerCase();
const LIMIT = 12;
export function assessPlanForLearning({question, logicalRequest, coverage, connectivity, accepted = [], evidencedGraph = {}, explorationSteps = 0}) {
  const entries = accepted instanceof Map ? [...accepted.values()] : arr(accepted);
  const missing = new Set(arr(coverage?.missing).map(norm));
  const fieldEvidence = new Map();
  for (const entry of entries) for (const c of arr(entry.covered)) {
    if (!c?.dimension || !c?.field) continue;
    const name = norm(c.dimension);
    if (!fieldEvidence.has(name)) fieldEvidence.set(name, []);
    fieldEvidence.get(name).push({entity:entry.entity, field:c.field, pathNames:arr(entry.pathNames).slice(0,4)});
  }
  const connected = connectivity?.connected === true;
  const plan = arr(logicalRequest?.steps).slice(0,LIMIT).map((step,index)=>({...step,stepId:`S${index+1}`}));
  const stepAssessment = plan.map(step => {
    const required = arr(step.requires);
    const absent = required.filter(name => missing.has(norm(name)) || !fieldEvidence.has(norm(name)));
    const verified = required.filter(name => !absent.includes(name)).map(name => ({concept:name,evidence:fieldEvidence.get(norm(name)).slice(0,4)}));
    const needsConnection = !!step.relation && !connected;
    const status = absent.length ? (verified.length ? 'partial' : 'unsupported') : needsConnection ? 'partial' : 'supported';
    return {stepId:step.stepId, action:step.action, status, requiredConcepts:required, supportedConcepts:verified,
      missingConcepts:absent, requiredRelation:step.relation || '', needsConnectivity:needsConnection};
  });
  const targets = stepAssessment.filter(step=>step.status !== 'supported').map(step=>({
    stepId:step.stepId, action:step.action, objective:step.missingConcepts.length
      ? `Establish evidence for ${step.missingConcepts.join(', ')} at the required grain`
      : `Establish the required evidenced relation: ${step.requiredRelation}`,
    requiredConcepts:step.requiredConcepts, missingConcepts:step.missingConcepts,
    requiredRelation:step.requiredRelation, needsConnectivity:step.needsConnectivity,
    knownEntityRefs:[...new Set(step.supportedConcepts.flatMap(c=>c.evidence.map(e=>e.entity)).filter(Boolean))].slice(0,12),
    operationHints:[], // Only the adapter may resolve executable CRUD/UI operations.
    acceptance:{concepts:step.missingConcepts,relation:step.requiredRelation,grain:logicalRequest?.grain || ''}
  }));
  if (!connected && !targets.length) targets.push({stepId:'CONNECT',action:'Connect accepted evidence', objective:'Establish verified joins between accepted entities at the required grain',missingConcepts:[],needsConnectivity:true,knownEntityRefs:entries.map(x=>x.entity).filter(Boolean).slice(0,12),operationHints:[]});
  const complete = !missing.size && connected && targets.length === 0;
  return {complete, stepAssessment, learningRequest:complete ? null : {
    version:2,status:'needs_learning',question,grain:logicalRequest?.grain || '',plan,
    targets,missingDimensions:arr(coverage?.missing),evidenceRefs:entries.map(e=>e.entity).filter(Boolean).slice(0,24),
    connectivity:{connected,unconnected:arr(connectivity?.unconnected).slice(0,12)},
    explorationSteps, evidenceGraphSummary:{entityCount:arr(evidencedGraph?.entities).length,joinCount:arr(evidencedGraph?.joins).length}
  }};
}
