import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureReplayPage,
  recordObservedTransition
} from '../src/captureAdapter.js';

function snapshot() {
  return {
    version: 1,
    url: '/a',
    title: 'A',
    root: {
      tag: 'body',
      attributes: {},
      directText: '',
      children: [
        {
          tag: 'label',
          attributes: { for: 'country' },
          directText: 'Country',
          children: []
        },
        {
          tag: 'div',
          attributes: { id: 'country', role: 'combobox', 'aria-label': 'Country' },
          directText: '',
          children: [
            { tag: 'div', attributes: { role: 'option' }, directText: 'India', children: [] },
            { tag: 'div', attributes: { role: 'option' }, directText: 'France', children: [] }
          ]
        }
      ]
    }
  };
}

function fixture() {
  return {
    version: 1,
    workflowId: 'wf:1',
    startPageId: 'page:a',
    pages: [{ pageId: 'page:a', snapshot: snapshot() }],
    transitions: []
  };
}

test('captures an existing safe structural snapshot without rewriting its hierarchy', () => {
  const source = snapshot();
  const page = captureReplayPage({ pageId: 'page:a', snapshot: source });

  assert.equal(page.pageId, 'page:a');
  assert.deepEqual(page.snapshot, source);
  assert.notEqual(page.snapshot, source);
  assert.equal(page.snapshot.root.children[1].attributes.role, 'combobox');
  assert.equal(page.snapshot.root.children[1].children[0].attributes.role, 'option');
});

test('rejects arbitrary raw html instead of treating it as a replay snapshot', () => {
  assert.throws(() => captureReplayPage({
    pageId: 'page:a',
    snapshot: { html: '<input value="blocked">' }
  }), /safe structural snapshot/i);
});

test('rejects runtime instance data in a captured snapshot', () => {
  const unsafe = snapshot();
  unsafe.root.children[1].instance = { selected: 'blocked' };
  assert.throws(() => captureReplayPage({ pageId: 'page:a', snapshot: unsafe }), /instance/i);
});

test('records a known observed transition through the replay fixture contract', () => {
  const current = {
    ...fixture(),
    pages: [
      { pageId: 'page:a', snapshot: snapshot() },
      { pageId: 'page:b', snapshot: { ...snapshot(), url: '/b', title: 'B' } }
    ]
  };

  const updated = recordObservedTransition({
    fixture: current,
    fromPageId: 'page:a',
    actionEntityId: 'control:next',
    toPageId: 'page:b'
  });

  assert.equal(updated.transitions.length, 1);
  assert.deepEqual(updated.transitions[0], {
    fromPageId: 'page:a',
    actionEntityId: 'control:next',
    toPageId: 'page:b'
  });
  assert.equal(updated.frontier, null);
});

test('records an unknown observed destination as the replay frontier', () => {
  const updated = recordObservedTransition({
    fixture: fixture(),
    fromPageId: 'page:a',
    actionEntityId: 'control:next',
    toPageId: null
  });

  assert.deepEqual(updated.frontier, {
    fromPageId: 'page:a',
    actionEntityId: 'control:next'
  });
});
