function assertInstanceGraph(graph) {
  if (!graph || !Array.isArray(graph.instances)) {
    throw new Error('An instance graph with an instances array is required.');
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function createInstanceGraph() {
  return {
    version: 1,
    instances: []
  };
}

export function findInstance(graph, entityId) {
  assertInstanceGraph(graph);
  if (!entityId) return null;
  return graph.instances.find((instance) => instance.entityId === entityId) || null;
}

export function upsertInstance(graph, incoming = {}) {
  assertInstanceGraph(graph);
  if (!incoming?.entityId) throw new Error('entityId is required.');

  const existing = findInstance(graph, incoming.entityId);
  const runtimeFields = {};

  if (Object.prototype.hasOwnProperty.call(incoming, 'value')) {
    runtimeFields.value = clone(incoming.value);
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'reference')) {
    runtimeFields.reference = clone(incoming.reference);
  }

  if (existing) {
    for (const key of Object.keys(existing)) {
      if (key !== 'entityId') delete existing[key];
    }
    Object.assign(existing, runtimeFields);
    return existing;
  }

  const instance = {
    entityId: incoming.entityId,
    ...runtimeFields
  };
  graph.instances.push(instance);
  return instance;
}

export function removeInstance(graph, entityId) {
  assertInstanceGraph(graph);
  if (!entityId) return null;

  const index = graph.instances.findIndex((instance) => instance.entityId === entityId);
  if (index < 0) return null;

  const [removed] = graph.instances.splice(index, 1);
  return removed;
}
