import { findEntity, linkEntities, upsertEntities } from '../graph/entityGraph.js';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

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

function stableAnchor(entity = {}) {
  const structural = entity.structural || {};
  const domId = clean(structural.domId);
  if (domId) return `${clean(entity.type)}|domId|${domId}`;

  if (entity.type === 'ui_control') {
    const controlType = clean(structural.controlType);
    const name = clean(structural.name);
    const label = clean(structural.label || entity.name);
    const href = clean(structural.href);
    if (controlType && (name || label || href)) {
      return `ui_control|${controlType}|${name}|${label}|${href}`;
    }
  }

  return '';
}

function uniqueAnchorMap(entities = []) {
  const buckets = new Map();
  for (const entity of entities) {
    const key = stableAnchor(entity);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entity.id);
  }

  const uniqueMap = new Map();
  for (const [key, ids] of buckets.entries()) {
    if (ids.length === 1) uniqueMap.set(key, ids[0]);
  }
  return uniqueMap;
}

function remapCurrentEntities(graphEntities, currentEntities) {
  const existingByAnchor = uniqueAnchorMap(graphEntities);
  const currentByAnchor = uniqueAnchorMap(currentEntities);
  const idRemap = new Map();

  const learnedIds = new Set(graphEntities.map((entity) => entity.id));
  for (const entity of currentEntities) {
    if (learnedIds.has(entity.id)) continue;
    const key = stableAnchor(entity);
    if (!key) continue;
    if (currentByAnchor.get(key) !== entity.id) continue;
    const existingId = existingByAnchor.get(key);
    if (existingId && existingId !== entity.id) {
      idRemap.set(entity.id, existingId);
    }
  }

  if (idRemap.size === 0) {
    return { entities: currentEntities, remappedEntityIds: {} };
  }

  const remappedEntityIds = Object.fromEntries(idRemap.entries());
  const entities = currentEntities.map((entity) => ({
    ...entity,
    id: idRemap.get(entity.id) || entity.id,
    structural: { ...(entity.structural || {}) },
    semantic: { ...(entity.semantic || {}) },
    links: (Array.isArray(entity.links) ? entity.links : []).map((link) => ({
      ...link,
      id: idRemap.get(link.id) || link.id
    }))
  }));

  return { entities, remappedEntityIds };
}

function cloneCondition(condition) {
  return condition === undefined
    ? undefined
    : JSON.parse(JSON.stringify(condition));
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

  const { entities: normalizedEntities, remappedEntityIds } = remapCurrentEntities(
    graph.entities,
    currentEntities
  );

  const learnedBefore = new Set(graph.entities.map((entity) => entity.id));
  const visibleEntityIds = unique(idsOf(normalizedEntities));
  const visibleNow = new Set(visibleEntityIds);
  const addedEntityIds = visibleEntityIds.filter((id) => !learnedBefore.has(id));
  const hiddenEntityIds = unique(previousVisibleEntityIds)
    .map((id) => remappedEntityIds[id] || id)
    .filter((id) => !visibleNow.has(id));

  upsertEntities(graph, normalizedEntities);

  const revealedRootIds = newlyRevealedRoots(normalizedEntities, addedEntityIds);

  if (trigger?.entityId) {
    const triggerEntityId = remappedEntityIds[trigger.entityId] || trigger.entityId;
    if (!findEntity(graph, triggerEntityId)) {
      throw new Error(`Unknown trigger entity: ${trigger.entityId}`);
    }

    for (const rootId of revealedRootIds) {
      const condition = cloneCondition(trigger.condition);
      linkEntities(
        graph,
        triggerEntityId,
        rootId,
        'dynamicChild',
        {
          reverseRelationship: 'revealedBy',
          metadata: condition === undefined ? {} : { condition }
        }
      );
    }
  }

  return {
    graph,
    addedEntityIds,
    hiddenEntityIds,
    visibleEntityIds,
    revealedRootIds,
    remappedEntityIds
  };
}
