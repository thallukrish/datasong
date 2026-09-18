function arr(value) { return Array.isArray(value) ? value : []; }

function observedInScenarios(evidence, scenarioIds) {
  if (evidence?.observed !== true) return false;
  const active = new Set(arr(scenarioIds).map(String).filter(Boolean));
  if (!active.size) return true;
  return arr(evidence?.scenarioIds).map(String).some((id) => active.has(id));
}

function edgeRuntimeEvidence(source, edge) {
  const targetName = String(edge?.target?.name || '');
  const relation = String(edge?.relation || '');
  const ref = arr(source?.references).find((candidate) =>
    String(candidate?.relation || '') === relation
    && String(candidate?.name || '') === targetName);
  return ref?.data?.runtimeEvidence || null;
}

export function selectOdooRuntimeTraversalEdges({ source, edges, scenarioIds = [] } = {}) {
  const candidates = arr(edges);
  if (candidates.length <= 1) {
    return { edges: candidates, reason: 'not_branch', prunedCount: 0 };
  }

  const edgeObserved = candidates.filter((edge) =>
    observedInScenarios(edgeRuntimeEvidence(source, edge), scenarioIds));

  if (edgeObserved.length) {
    return {
      edges: edgeObserved,
      reason: 'observed_edge',
      prunedCount: candidates.length - edgeObserved.length
    };
  }

  const targetObserved = candidates.filter((edge) =>
    observedInScenarios(edge?.target?.runtimeEvidence, scenarioIds));

  if (targetObserved.length) {
    return {
      edges: targetObserved,
      reason: 'observed_target',
      prunedCount: candidates.length - targetObserved.length
    };
  }

  return { edges: candidates, reason: 'no_runtime_match', prunedCount: 0 };
}

function methodKey(value) {
  return `${String(value?.modelName || value?.model || '')}.${String(value?.methodName || value?.method || '')}`;
}

export function runtimeObservedMethodKeys(trace) {
  return new Set(arr(trace?.events)
    .filter((event) => event?.model && event?.method)
    .map((event) => methodKey(event)));
}

export function selectRuntimeMethodCandidates(candidates, observedKeys) {
  const items = arr(candidates);
  if (items.length <= 1 || !(observedKeys instanceof Set) || !observedKeys.size) {
    return { candidates: items, reason: 'not_runtime_branch', prunedCount: 0 };
  }
  const observed = items.filter((candidate) => observedKeys.has(methodKey(candidate)));
  if (!observed.length) return { candidates: items, reason: 'no_runtime_match', prunedCount: 0 };
  return {
    candidates: observed,
    reason: 'observed_method',
    prunedCount: items.length - observed.length
  };
}
