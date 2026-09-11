import { findEntity, upsertEntities } from '../graph/entityGraph.js';

function ids(entities = []) {
  return entities.map((entity) => entity?.id).filter(Boolean);
}

export function mergePageVisit({ graph, page, entities = [] } = {}) {
  if (!graph || !Array.isArray(graph.entities)) {
    throw new Error('A graph with entities is required.');
  }
  if (!page?.id) throw new Error('A page entity is required.');
  if (!Array.isArray(entities)) throw new Error('entities must be an array.');

  const existed = Boolean(findEntity(graph, page.id));
  const beforeIds = new Set(graph.entities.map((entity) => entity.id));

  const incoming = [page, ...entities.filter((entity) => entity?.id !== page.id)];
  upsertEntities(graph, incoming);

  const addedEntityIds = ids(incoming).filter((id) => !beforeIds.has(id));

  return {
    graph,
    pageEntityId: page.id,
    reusedPage: existed,
    addedEntityIds: [...new Set(addedEntityIds)]
  };
}
