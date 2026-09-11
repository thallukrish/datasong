function cloneLink(link = {}) {
  return JSON.parse(JSON.stringify(link));
}

function cloneEntity(entity = {}) {
  return {
    ...entity,
    structural: { ...(entity.structural || {}) },
    semantic: { ...(entity.semantic || {}) },
    links: Array.isArray(entity.links) ? entity.links.map(cloneLink) : []
  };
}

function linkKey(link = {}) {
  return JSON.stringify(link);
}

function mergeLinks(existing = [], incoming = []) {
  const merged = existing.map(cloneLink);
  const seen = new Set(merged.map(linkKey));

  for (const link of incoming) {
    const copy = cloneLink(link);
    const key = linkKey(copy);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(copy);
  }

  return merged;
}

function assertGraph(graph) {
  if (!graph || !Array.isArray(graph.entities)) {
    throw new Error('A graph with an entities array is required.');
  }
}

export function findEntity(graph, id) {
  assertGraph(graph);
  return graph.entities.find((entity) => entity.id === id) || null;
}

export function upsertEntity(graph, incoming = {}) {
  assertGraph(graph);
  if (!incoming?.id) throw new Error('Entity id is required.');

  const existing = findEntity(graph, incoming.id);
  if (!existing) {
    const inserted = cloneEntity(incoming);
    graph.entities.push(inserted);
    return inserted;
  }

  if (incoming.type) existing.type = incoming.type;
  if (incoming.name !== undefined) existing.name = incoming.name;

  existing.structural = {
    ...(existing.structural || {}),
    ...(incoming.structural || {})
  };
  existing.semantic = {
    ...(existing.semantic || {}),
    ...(incoming.semantic || {})
  };
  existing.links = mergeLinks(
    Array.isArray(existing.links) ? existing.links : [],
    Array.isArray(incoming.links) ? incoming.links : []
  );

  return existing;
}

export function upsertEntities(graph, entities = []) {
  assertGraph(graph);
  if (!Array.isArray(entities)) throw new Error('entities must be an array.');
  return entities.map((entity) => upsertEntity(graph, entity));
}

export function createEntityGraph({ entities = [] } = {}) {
  const graph = {
    version: 1,
    entities: []
  };
  upsertEntities(graph, entities);
  return graph;
}

function addLink(entity, link) {
  if (!Array.isArray(entity.links)) entity.links = [];
  const key = linkKey(link);
  if (!entity.links.some((candidate) => linkKey(candidate) === key)) {
    entity.links.push(cloneLink(link));
  }
}

export function linkEntities(graph, fromId, toId, relationship, {
  reverseRelationship = '',
  metadata = {}
} = {}) {
  assertGraph(graph);
  const from = findEntity(graph, fromId);
  const to = findEntity(graph, toId);

  if (!from || !to) {
    throw new Error(`Cannot link unknown entity: ${fromId} -> ${toId}`);
  }
  if (!relationship) throw new Error('relationship is required.');

  addLink(from, {
    id: to.id,
    relationship,
    ...(metadata || {})
  });

  if (reverseRelationship) {
    addLink(to, {
      id: from.id,
      relationship: reverseRelationship
    });
  }

  return { from, to };
}

export function mergeSemanticPatch(graph, entityId, patch = {}) {
  assertGraph(graph);
  const entity = findEntity(graph, entityId);
  if (!entity) throw new Error(`Unknown entity: ${entityId}`);

  entity.semantic = {
    ...(entity.semantic || {}),
    ...(patch || {})
  };
  return entity;
}
