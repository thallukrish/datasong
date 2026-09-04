import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEntityDelta } from '../src/graph/entityDelta.js';
import { normalizeExternalEffect } from '../src/explore/behaviorSampling.js';
import { createSemanticMemory } from '../src/agent/memory.js';
import { classifyAndRecordExecutionBehavior } from '../src/agent/executionBehavior.js';

test('entity delta preserves structural target identity for interaction-triggered branches', () => {
  const delta = computeEntityDelta(
    { entityId: 'entity:parent', presentation: { route: '/setup' }, fields: {}, regions: {} },
    { entityId: 'entity:modal', presentation: { route: '/setup' }, fields: {}, regions: {} }
  );
  assert.equal(delta.entityChanged, true);
  assert.equal(delta.fromEntityId, 'entity:parent');
  assert.equal(delta.toEntityId, 'entity:modal');

  const effect = normalizeExternalEffect(delta);
  assert.equal(effect.fromEntityId, 'entity:parent');
  assert.equal(effect.toEntityId, 'entity:modal');
});

test('route transition evidence preserves source and target routes', () => {
  const delta = computeEntityDelta(
    { entityId: 'entity:a', presentation: { route: '/a' }, fields: {}, regions: {} },
    { entityId: 'entity:b', presentation: { route: '/b' }, fields: {}, regions: {} }
  );
  assert.equal(delta.routeChanged, true);
  assert.equal(delta.fromRoute, '/a');
  assert.equal(delta.toRoute, '/b');
});

test('execution behavior persists source interaction to target entity transition evidence', () => {
  const memory = createSemanticMemory('configure account');
  memory.entities['entity:parent'] = {
    id: 'entity:parent',
    semantic: { semanticName: 'Account type', interactions: [] },
    executionBehaviors: {}
  };
  const delta = computeEntityDelta(
    { entityId: 'entity:parent', presentation: { route: '/setup' }, fields: {}, regions: {} },
    { entityId: 'entity:modal', presentation: { route: '/setup' }, fields: {}, regions: {} }
  );

  const result = classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:parent',
    semanticKey: 'account-type',
    sourceFieldIds: ['field:type'],
    delta
  });

  assert.equal(result.classId, 'behavior:account-type:1');
  assert.deepEqual(memory.entities['entity:parent'].executionTransitions, [{
    semanticKey: 'account-type',
    behaviorClassId: 'behavior:account-type:1',
    sourceFieldIds: ['field:type'],
    targetEntityId: 'entity:modal',
    targetRoute: ''
  }]);
});
