function cloneEntity(entity = {}) {
  return {
    ...entity,
    structural: { ...(entity.structural || {}) },
    semantic: { ...(entity.semantic || {}) },
    links: Array.isArray(entity.links) ? entity.links.map((link) => ({ ...link })) : []
  };
}

function addLink(entity, link) {
  const exists = entity.links.some((candidate) => (
    candidate.id === link.id && candidate.relationship === link.relationship
  ));
  if (!exists) entity.links.push(link);
}

export function buildPageHierarchy({ page, entities = [], hierarchy = [] } = {}) {
  if (!page?.id) throw new Error('A page entity is required.');
  if (!Array.isArray(entities)) throw new Error('entities must be an array.');
  if (!Array.isArray(hierarchy)) throw new Error('hierarchy must be an array.');

  const materializedEntities = entities.map(cloneEntity);
  const byId = new Map(materializedEntities.map((entity) => [entity.id, entity]));

  if (!byId.has(page.id)) throw new Error(`Page entity ${page.id} is missing from entities.`);

  for (const edge of hierarchy) {
    const parent = byId.get(edge?.parentId);
    const child = byId.get(edge?.childId);

    if (!parent || !child) {
      throw new Error(`Hierarchy edge references unknown entity: ${edge?.parentId || '?'} -> ${edge?.childId || '?'}`);
    }

    if (parent.id === child.id) {
      throw new Error(`Hierarchy edge cannot contain itself: ${parent.id}`);
    }

    addLink(parent, { id: child.id, relationship: 'contains' });
    addLink(child, { id: parent.id, relationship: 'partOf' });
  }

  return {
    page: byId.get(page.id),
    entities: materializedEntities,
    byId
  };
}
