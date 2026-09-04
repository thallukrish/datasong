function arr(value) { return Array.isArray(value) ? value : []; }

export function createEntityGraph(entities = []) {
  return arr(entities).map((entity) => ({
    ...structuredClone(entity),
    structural: structuredClone(entity?.structural || {}),
    semantic: structuredClone(entity?.semantic || {}),
    links: arr(entity?.links).map((link) => ({ id: String(link.id || ''), relationship: String(link.relationship || '') })).filter((link) => link.id && link.relationship)
  }));
}

export function findEntity(graph = [], id = '') {
  return arr(graph).find((entity) => entity.id === id) || null;
}

export function upsertEntity(graph = [], entity = {}) {
  if (!entity?.id) throw new Error('Entity id is required');
  const existing = findEntity(graph, entity.id);
  if (!existing) {
    const node = {
      id: String(entity.id),
      name: String(entity.name || ''),
      type: String(entity.type || 'unknown'),
      structural: structuredClone(entity.structural || {}),
      semantic: structuredClone(entity.semantic || {}),
      links: arr(entity.links).map((link) => ({ id: String(link.id || ''), relationship: String(link.relationship || '') })).filter((link) => link.id && link.relationship)
    };
    graph.push(node);
    return node;
  }

  if (entity.name !== undefined) existing.name = String(entity.name || '');
  if (entity.type !== undefined) existing.type = String(entity.type || 'unknown');
  if (entity.structural) existing.structural = { ...existing.structural, ...structuredClone(entity.structural) };
  if (entity.semantic) existing.semantic = { ...existing.semantic, ...structuredClone(entity.semantic) };
  for (const link of arr(entity.links)) addLink(existing, link.id, link.relationship);
  return existing;
}

function addLink(entity, targetId, relationship) {
  const id = String(targetId || '');
  const rel = String(relationship || '');
  if (!id || !rel) return;
  if (!arr(entity.links).some((link) => link.id === id && link.relationship === rel)) entity.links.push({ id, relationship: rel });
}

export function linkEntities(graph = [], sourceId = '', targetId = '', forwardRelationship = '', reverseRelationship = '') {
  const source = findEntity(graph, sourceId);
  const target = findEntity(graph, targetId);
  if (!source || !target) throw new Error(`Cannot link missing entities ${sourceId} -> ${targetId}`);
  addLink(source, targetId, forwardRelationship);
  addLink(target, sourceId, reverseRelationship);
  return { source, target };
}

export function mergeSemanticPatch(graph = [], id = '', semantic = {}) {
  const entity = findEntity(graph, id);
  if (!entity) throw new Error(`Missing entity ${id}`);
  entity.semantic = { ...entity.semantic, ...structuredClone(semantic || {}) };
  return entity;
}
