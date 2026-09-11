import { findEntity, linkEntities, upsertEntities } from '../graph/entityGraph.js';

function idsOf(entities = []) {
  return entities.map((entity) => entity?.id).filter(Boolean);
}

function physicalParentIds(entity = {}) {
  return (Array.isArray(entity.links) ? entity.links : [])
    .filter((link) => link.relationship === 'partOf')
    .map((link) => link.id);
}

function newlyRevealedRoots(currentEntities, addedIds) {
  const added = new Set(addedIds);
  return currentEntities
    .filter((entity) => added.has(entity?.id))
    .filter((entity) => entity.type !== 'page' && entity.type !== 'ui_group')
    .filter((entity) => !physicalParentIds(entity).some((parentId) => added.has(parentId)))
    .map((entity) => entity.id);
}

function unique(values = []) {
  return [...new Set(values)];
}

export function reconcileVisibleState({
  graph,
  currentEntities = [],
  previousVisibleEntityIds = [],
  trigger = null
} = {}) {
  if (!graph || !Array.isArray(graph.entities)) {
    throw new Error('A graph with an entities array is required.');
  }
  if (!Array.isArray(currentEntities)) {
    throw new Error('currentEntities must be an array.');
  }
  if (!Array.isArray(previousVisibleEntityIds)) {
    throw new Error('previousVisibleEntityIds must be an array.');
  }

  const learnedBefore = new Set(graph.entities.map((entity) => entity.id));
  const visibleEntityIds = unique(idsOf(currentEntities));
  const visibleNow = new Set(visibleEntityIds);
  const addedEntityIds = visibleEntityIds.filter((id) => !learnedBefore.has(id));
  const hiddenEntityIds = unique(previousVisibleEntityIds)
    .filter((id) => !visibleNow.has(id));

  upsertEntities(graph, currentEntities);

  const revealedRootIds = newlyRevealedRoots(currentEntities, addedEntityIds);

  if (trigger?.entityId) {
    if (!findEntity(graph, trigger.entityId)) {
      throw new Error(`Unknown trigger entity: ${trigger.entityId}`);
    }

    for (const rootId of revealedRootIds) {
      linkEntities(
        graph,
        trigger.entityId,
        rootId,
        'dynamicChild',
        {
          reverseRelationship: 'revealedBy',
          metadata: trigger.condition === undefined
            ? {}
            : { condition: structuredClone(trigger.condition) }
        }
      );
    }
  }

  return {
    graph,
    addedEntityIds,
    hiddenEntityIds,
    visibleEntityIds,
    revealedRootIds
  };
}
