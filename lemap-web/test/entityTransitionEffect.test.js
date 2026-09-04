import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEntityDelta } from '../src/graph/entityDelta.js';
import { normalizeExternalEffect } from '../src/explore/behaviorSampling.js';

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
