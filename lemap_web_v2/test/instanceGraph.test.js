import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInstanceGraph,
  findInstance,
  upsertInstance,
  removeInstance
} from '../src/graph/instanceGraph.js';

test('createInstanceGraph starts as an empty serializable sparse graph', () => {
  const graph = createInstanceGraph();

  assert.deepEqual(graph, {
    version: 1,
    instances: []
  });
  assert.doesNotThrow(() => JSON.stringify(graph));
});

test('upsertInstance stores a runtime value by structural entity id without duplicating entries', () => {
  const graph = createInstanceGraph();

  upsertInstance(graph, { entityId: 'control:income', value: '1000' });
  upsertInstance(graph, { entityId: 'control:income', value: '1250' });

  assert.equal(graph.instances.length, 1);
  assert.deepEqual(findInstance(graph, 'control:income'), {
    entityId: 'control:income',
    value: '1250'
  });
});

test('upsertInstance can store a local reference without copying structural entity data', () => {
  const graph = createInstanceGraph();

  upsertInstance(graph, {
    entityId: 'control:document',
    reference: { kind: 'local-file', id: 'file:7' }
  });

  const instance = findInstance(graph, 'control:document');
  assert.deepEqual(instance, {
    entityId: 'control:document',
    reference: { kind: 'local-file', id: 'file:7' }
  });
  assert.equal('structural' in instance, false);
  assert.equal('semantic' in instance, false);
  assert.equal('links' in instance, false);
});

test('removeInstance removes runtime state without implying structural entity deletion', () => {
  const graph = createInstanceGraph();
  upsertInstance(graph, { entityId: 'control:status', value: 'N' });

  const removed = removeInstance(graph, 'control:status');

  assert.deepEqual(removed, { entityId: 'control:status', value: 'N' });
  assert.equal(findInstance(graph, 'control:status'), null);
  assert.deepEqual(graph.instances, []);
});

test('instance operations reject records without a structural entity id', () => {
  const graph = createInstanceGraph();

  assert.throws(() => upsertInstance(graph, { value: 'secret' }), /entityId/i);
  assert.equal(findInstance(graph, ''), null);
});
