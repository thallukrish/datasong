import crypto from 'node:crypto';
import { findEntity, linkEntities, upsertEntity } from './entityGraph.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function hash(value) { return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12); }

const REVERSE = new Map([
  ['contains', 'childOf'],
  ['childOf', 'contains'],
  ['partOf', 'contains'],
  ['instanceOf', 'hasInstance'],
  ['transitionsTo', 'reachedFrom'],
  ['reachedFrom', 'transitionsTo'],
  ['partOfWorkflow', 'contains'],
  ['copyOf', 'hasCopy'],
  ['hasCopy', 'copyOf'],
  ['appearsOnModificationOf', 'causesAppearanceOf'],
  ['causesAppearanceOf', 'appearsOnModificationOf'],
  ['onModificationOf', 'causesModificationOf'],
  ['causesModificationOf', 'onModificationOf']
]);

function comparableStructural(entity = {}) {
  return structuredClone(entity.structural || {});
}

function sameStructure(a = {}, b = {}) {
  return JSON.stringify(comparableStructural(a)) === JSON.stringify(comparableStructural(b));
}

function copyContextLinks(graph, entity = {}) {
  for (const link of arr(entity.links)) {
    if (!findEntity(graph, link.id)) continue;
    const reverse = REVERSE.get(link.relationship);
    if (!reverse) continue;
    linkEntities(graph, entity.id, link.id, link.relationship, reverse);
  }
}

function addNewEntity(graph, entity, triggerEntityId) {
  const node = upsertEntity(graph, entity);
  copyContextLinks(graph, node);
  if (triggerEntityId && findEntity(graph, triggerEntityId)) {
    linkEntities(graph, triggerEntityId, node.id, 'causesAppearanceOf', 'appearsOnModificationOf');
  }
  return node;
}

function addVersionEntity(graph, original, observed, triggerEntityId) {
  const versionId = `${original.id}:state:${hash(JSON.stringify(observed.structural || {}))}`;
  const node = upsertEntity(graph, {
    id: versionId,
    name: observed.name || original.name,
    type: observed.type || original.type,
    structural: structuredClone(observed.structural || {}),
    semantic: structuredClone(original.semantic || observed.semantic || {}),
    links: []
  });

  for (const link of arr(observed.links)) {
    if (!findEntity(graph, link.id)) continue;
    const reverse = REVERSE.get(link.relationship);
    if (!reverse) continue;
    linkEntities(graph, node.id, link.id, link.relationship, reverse);
  }

  linkEntities(graph, node.id, original.id, 'copyOf', 'hasCopy');
  if (triggerEntityId && findEntity(graph, triggerEntityId)) {
    linkEntities(graph, triggerEntityId, node.id, 'causesModificationOf', 'onModificationOf');
  }
  return node;
}

export function applyObservedStructuralChange(graph = [], {
  beforeEntities = [],
  afterEntities = [],
  triggerEntityId = '',
  ignoredEntityIds = []
} = {}) {
  const beforeById = new Map(arr(beforeEntities).map((entity) => [entity.id, entity]));
  const ignored = new Set(arr(ignoredEntityIds).map(String));
  const addedEntityIds = [];
  const versionEntityIds = [];

  for (const observed of arr(afterEntities)) {
    const before = beforeById.get(observed.id);
    if (!before) {
      addNewEntity(graph, observed, triggerEntityId);
      addedEntityIds.push(observed.id);
      continue;
    }
    if (ignored.has(observed.id) || sameStructure(before, observed)) continue;
    const version = addVersionEntity(graph, before, observed, triggerEntityId);
    versionEntityIds.push(version.id);
  }

  return { addedEntityIds, versionEntityIds };
}
