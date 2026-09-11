import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityGraph, findEntity } from '../src/graph/entityGraph.js';
import { reconcileVisibleState } from '../src/orchestrator/graphReconciler.js';

function entity(id, {
  type = 'container',
  name = id,
  structural = {},
  semantic = {},
  links = []
} = {}) {
  return { id, type, name, structural, semantic, links };
}

test('reconcileVisibleState adds newly revealed entities without replacing learned entities', () => {
  const page = entity('page:1', { type: 'page', semantic: { purpose: 'filing' } });
  const section = entity('section:1', { links: [{ id: 'page:1', relationship: 'partOf' }] });
  const graph = createEntityGraph({ entities: [page] });

  const result = reconcileVisibleState({
    graph,
    currentEntities: [page, section],
    previousVisibleEntityIds: ['page:1']
  });

  assert.deepEqual(result.addedEntityIds, ['section:1']);
  assert.deepEqual(result.visibleEntityIds, ['page:1', 'section:1']);
  assert.equal(findEntity(graph, 'page:1').semantic.purpose, 'filing');
  assert.ok(findEntity(graph, 'section:1'));
});

test('reconcileVisibleState records the trigger condition on the root of a newly revealed branch', () => {
  const page = entity('page:1', { type: 'page' });
  const trigger = entity('radio:status', { type: 'ui_control' });
  const section = entity('section:reason', {
    links: [{ id: 'page:1', relationship: 'partOf' }]
  });
  const input = entity('input:reason', {
    type: 'ui_control',
    links: [{ id: 'section:reason', relationship: 'partOf' }]
  });
  const graph = createEntityGraph({ entities: [page, trigger] });

  const result = reconcileVisibleState({
    graph,
    currentEntities: [page, trigger, section, input],
    previousVisibleEntityIds: ['page:1', 'radio:status'],
    trigger: {
      entityId: 'radio:status',
      condition: { value: 'N' }
    }
  });

  assert.deepEqual(result.revealedRootIds, ['section:reason']);
  assert.deepEqual(
    findEntity(graph, 'radio:status').links.find((link) => link.relationship === 'dynamicChild'),
    { id: 'section:reason', relationship: 'dynamicChild', condition: { value: 'N' } }
  );
  assert.deepEqual(
    findEntity(graph, 'section:reason').links.find((link) => link.relationship === 'revealedBy'),
    { id: 'radio:status', relationship: 'revealedBy' }
  );
  assert.equal(
    findEntity(graph, 'radio:status').links.some((link) => link.id === 'input:reason' && link.relationship === 'dynamicChild'),
    false
  );
});

test('reconcileVisibleState keeps hidden entities in the persistent graph', () => {
  const page = entity('page:1', { type: 'page' });
  const section = entity('section:conditional');
  const graph = createEntityGraph({ entities: [page, section] });

  const result = reconcileVisibleState({
    graph,
    currentEntities: [page],
    previousVisibleEntityIds: ['page:1', 'section:conditional']
  });

  assert.deepEqual(result.hiddenEntityIds, ['section:conditional']);
  assert.ok(findEntity(graph, 'section:conditional'));
  assert.deepEqual(result.visibleEntityIds, ['page:1']);
});

test('reconciling the same revealed state twice does not duplicate entities or causal links', () => {
  const page = entity('page:1', { type: 'page' });
  const trigger = entity('radio:status', { type: 'ui_control' });
  const section = entity('section:reason', {
    links: [{ id: 'page:1', relationship: 'partOf' }]
  });
  const graph = createEntityGraph({ entities: [page, trigger] });

  const args = {
    graph,
    currentEntities: [page, trigger, section],
    previousVisibleEntityIds: ['page:1', 'radio:status'],
    trigger: { entityId: 'radio:status', condition: { value: 'N' } }
  };

  reconcileVisibleState(args);
  const second = reconcileVisibleState({
    ...args,
    previousVisibleEntityIds: ['page:1', 'radio:status', 'section:reason']
  });

  assert.deepEqual(second.addedEntityIds, []);
  assert.equal(graph.entities.filter((candidate) => candidate.id === 'section:reason').length, 1);
  assert.equal(
    findEntity(graph, 'radio:status').links.filter((link) => link.relationship === 'dynamicChild' && link.id === 'section:reason').length,
    1
  );
});

test('reconcileVisibleState rejects an unknown trigger entity', () => {
  const page = entity('page:1', { type: 'page' });
  const graph = createEntityGraph({ entities: [page] });

  assert.throws(() => reconcileVisibleState({
    graph,
    currentEntities: [page],
    trigger: { entityId: 'missing:1', condition: { value: 'N' } }
  }), /Unknown trigger entity/);
});
