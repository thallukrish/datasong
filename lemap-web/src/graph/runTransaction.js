function clone(value) {
  return structuredClone(Array.isArray(value) ? value : []);
}

function addLink(entity, link = {}) {
  const id = String(link?.id || '');
  const relationship = String(link?.relationship || '');
  if (!id || !relationship) return;
  if (!Array.isArray(entity.links)) entity.links = [];
  if (!entity.links.some((item) => item.id === id && item.relationship === relationship)) {
    entity.links.push({ id, relationship });
  }
}

export function createRunTransaction(entityGraph = [], instanceGraph = []) {
  return {
    entityGraph: clone(entityGraph),
    instanceGraph: clone(instanceGraph)
  };
}

export function mergeObservedStructure(canonicalGraph = [], workingGraph = []) {
  for (const observed of Array.isArray(workingGraph) ? workingGraph : []) {
    if (!observed?.id) continue;
    let canonical = canonicalGraph.find((entity) => entity.id === observed.id);
    if (!canonical) {
      canonical = {
        id: String(observed.id),
        name: String(observed.name || ''),
        type: String(observed.type || 'unknown'),
        structural: structuredClone(observed.structural || {}),
        semantic: {},
        links: []
      };
      canonicalGraph.push(canonical);
    } else {
      if (observed.name !== undefined) canonical.name = String(observed.name || '');
      if (observed.type !== undefined) canonical.type = String(observed.type || 'unknown');
      canonical.structural = { ...canonical.structural, ...structuredClone(observed.structural || {}) };
      if (!canonical.semantic || typeof canonical.semantic !== 'object') canonical.semantic = {};
      if (!Array.isArray(canonical.links)) canonical.links = [];
    }

    for (const link of Array.isArray(observed.links) ? observed.links : []) addLink(canonical, link);
  }
  return canonicalGraph;
}

export function shouldPromoteRun(reason = '') {
  if (!reason) return false;
  return !['error', 'interrupted'].includes(String(reason));
}
