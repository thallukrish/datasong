import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityGraph, findEntity } from '../src/graph/entityGraph.js';
import {
  registerNavigationEntity,
  resolveNavigationDestination
} from '../src/orchestrator/navigationResolver.js';

function entity(id, {
  type = 'ui_control',
  name = id,
  structural = {},
  semantic = {},
  links = []
} = {}) {
  return { id, type, name, structural, semantic, links };
}

test('registerNavigationEntity marks a link control as navigation without changing its identity', () => {
  const link = entity('control:next', {
    name: 'Continue',
    structural: { controlType: 'link', href: '/next', disabled: false }
  });
  const graph = createEntityGraph({ entities: [link] });

  const result = registerNavigationEntity(graph, 'control:next');

  assert.equal(result.id, 'control:next');
  assert.equal(result.structural.navigation, true);
  assert.equal(result.structural.navigationKind, 'link');
  assert.equal(result.structural.href, '/next');
});

test('registerNavigationEntity can mark a button as a navigation control', () => {
  const button = entity('control:continue', {
    name: 'Continue',
    structural: { controlType: 'button', disabled: false }
  });
  const graph = createEntityGraph({ entities: [button] });

  const result = registerNavigationEntity(graph, 'control:continue');

  assert.equal(result.structural.navigation, true);
  assert.equal(result.structural.navigationKind, 'button');
});

test('resolveNavigationDestination links a navigation control to a learned page', () => {
  const control = entity('control:next', {
    structural: { controlType: 'link', href: '/next' }
  });
  const page = entity('page:next', {
    type: 'page',
    structural: { origin: 'https://example.test', route: '/next' }
  });
  const graph = createEntityGraph({ entities: [control, page] });

  resolveNavigationDestination(graph, 'control:next', 'page:next');

  assert.deepEqual(
    findEntity(graph, 'control:next').links.find((link) => link.relationship === 'transitionsTo'),
    { id: 'page:next', relationship: 'transitionsTo' }
  );
  assert.deepEqual(
    findEntity(graph, 'page:next').links.find((link) => link.relationship === 'enteredVia'),
    { id: 'control:next', relationship: 'enteredVia' }
  );
});

test('registerNavigationEntity keeps unresolved destinations unresolved until followed', () => {
  const link = entity('control:next', {
    structural: { controlType: 'link', href: '/unknown' }
  });
  const graph = createEntityGraph({ entities: [link] });

  const result = registerNavigationEntity(graph, 'control:next');

  assert.equal(result.structural.navigation, true);
  assert.equal(result.links.some((link) => link.relationship === 'transitionsTo'), false);
});

test('navigation resolution is idempotent', () => {
  const control = entity('control:next', { structural: { controlType: 'button' } });
  const page = entity('page:next', { type: 'page' });
  const graph = createEntityGraph({ entities: [control, page] });

  resolveNavigationDestination(graph, 'control:next', 'page:next');
  resolveNavigationDestination(graph, 'control:next', 'page:next');

  assert.equal(
    findEntity(graph, 'control:next').links.filter((link) => link.relationship === 'transitionsTo').length,
    1
  );
});

test('navigation functions reject unknown entities and non-controls', () => {
  const page = entity('page:1', { type: 'page' });
  const graph = createEntityGraph({ entities: [page] });

  assert.throws(() => registerNavigationEntity(graph, 'missing'), /Unknown navigation entity/);
  assert.throws(() => registerNavigationEntity(graph, 'page:1'), /must be a ui_control/);
  assert.throws(() => resolveNavigationDestination(graph, 'page:1', 'missing'), /Unknown destination page/);
});
