import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeObservedStructure } from '../src/graph/runTransaction.js';

function entity(id, { name = id, type = 'ui_control', structural = {}, semantic = {}, links = [] } = {}) {
  return { id, name, type, structural, semantic, links };
}

test('observed structure persists without copying provisional semantic guesses', () => {
  const canonical = [
    entity('page:1', {
      type: 'page',
      structural: { route: '/one' },
      semantic: { meaning: 'known stable meaning' },
      links: []
    })
  ];

  const working = [
    entity('page:1', {
      type: 'page',
      structural: { route: '/one', title: 'Updated title' },
      semantic: { meaning: 'provisional replacement', complete: false },
      links: [{ id: 'action:next', relationship: 'contains' }]
    }),
    entity('action:next', {
      name: 'Primary action',
      structural: { controlType: 'button', visible: true },
      semantic: { relevantToGoal: true },
      links: [
        { id: 'page:1', relationship: 'childOf' },
        { id: 'page:2', relationship: 'transitionsTo' }
      ]
    }),
    entity('page:2', {
      type: 'page',
      structural: { route: '/two' },
      semantic: { meaning: 'provisional page meaning' },
      links: [{ id: 'action:next', relationship: 'reachedFrom' }]
    })
  ];

  mergeObservedStructure(canonical, working);

  const page1 = canonical.find((item) => item.id === 'page:1');
  const action = canonical.find((item) => item.id === 'action:next');
  const page2 = canonical.find((item) => item.id === 'page:2');

  assert.equal(page1.structural.title, 'Updated title');
  assert.deepEqual(page1.semantic, { meaning: 'known stable meaning' });
  assert.ok(page1.links.some((link) => link.id === 'action:next' && link.relationship === 'contains'));

  assert.ok(action);
  assert.deepEqual(action.semantic, {});
  assert.ok(action.links.some((link) => link.id === 'page:2' && link.relationship === 'transitionsTo'));

  assert.ok(page2);
  assert.deepEqual(page2.semantic, {});
});

test('mergeObservedStructure is idempotent for links', () => {
  const canonical = [];
  const working = [
    entity('page:1', { type: 'page', links: [{ id: 'action:a', relationship: 'contains' }] }),
    entity('action:a', { links: [{ id: 'page:1', relationship: 'childOf' }] })
  ];

  mergeObservedStructure(canonical, working);
  mergeObservedStructure(canonical, working);

  assert.equal(canonical.find((item) => item.id === 'page:1').links.length, 1);
  assert.equal(canonical.find((item) => item.id === 'action:a').links.length, 1);
});
