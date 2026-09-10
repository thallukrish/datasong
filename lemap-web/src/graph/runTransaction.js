function clone(value) {
  return structuredClone(Array.isArray(value) ? value : []);
}

export function createRunTransaction(entityGraph = [], instanceGraph = []) {
  return {
    entityGraph: clone(entityGraph),
    instanceGraph: clone(instanceGraph)
  };
}

export function shouldPromoteRun(reason = '') {
  return reason === 'workflow_complete' || reason === 'consequential_action';
}
