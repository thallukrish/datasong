import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReplayFixture, validateReplayPage, validateReplayTransition } from '../src/fixtureSchema.js';

function snapshot(url = '/a', title = 'A') {
  return { version: 1, url, title, root: { tag: 'body', attributes: {}, directText: '', children: [] } };
}

test('normalizes a depth-first replay fixture with an unknown frontier', () => {
  const fixture = normalizeReplayFixture({
    version: 1,
    workflowId: 'wf:1',
    startPageId: 'page:a',
    pages: [{ pageId: 'page:a', snapshot: snapshot() }],
    transitions: [{ fromPageId: 'page:a', actionEntityId: 'control:next', toPageId: null }]
  });
  assert.equal(fixture.startPageId, 'page:a');
  assert.equal(fixture.transitions[0].toPageId, null);
  assert.deepEqual(fixture.frontier, { fromPageId: 'page:a', actionEntityId: 'control:next' });
});

test('fixture without an unknown transition has no frontier', () => {
  const fixture = normalizeReplayFixture({
    version: 1,
    workflowId: 'wf:1',
    startPageId: 'page:a',
    pages: [
      { pageId: 'page:a', snapshot: snapshot('/a', 'A') },
      { pageId: 'page:b', snapshot: snapshot('/b', 'B') }
    ],
    transitions: [{ fromPageId: 'page:a', actionEntityId: 'control:next', toPageId: 'page:b' }]
  });
  assert.equal(fixture.frontier, null);
});

test('rejects duplicate page ids and absent transition endpoints', () => {
  assert.throws(() => normalizeReplayFixture({
    version: 1, workflowId: 'wf:1', startPageId: 'page:a',
    pages: [{ pageId: 'page:a', snapshot: snapshot() }, { pageId: 'page:a', snapshot: snapshot() }],
    transitions: []
  }), /duplicate page/i);

  assert.throws(() => normalizeReplayFixture({
    version: 1, workflowId: 'wf:1', startPageId: 'page:a',
    pages: [{ pageId: 'page:a', snapshot: snapshot() }],
    transitions: [{ fromPageId: 'page:missing', actionEntityId: 'control:next', toPageId: null }]
  }), /source page/i);

  assert.throws(() => normalizeReplayFixture({
    version: 1, workflowId: 'wf:1', startPageId: 'page:a',
    pages: [{ pageId: 'page:a', snapshot: snapshot() }],
    transitions: [{ fromPageId: 'page:a', actionEntityId: 'control:next', toPageId: 'page:missing' }]
  }), /destination page/i);
});

test('rejects competing transitions and multiple unknown frontiers', () => {
  assert.throws(() => normalizeReplayFixture({
    version: 1, workflowId: 'wf:1', startPageId: 'page:a',
    pages: [{ pageId: 'page:a', snapshot: snapshot() }, { pageId: 'page:b', snapshot: snapshot('/b', 'B') }],
    transitions: [
      { fromPageId: 'page:a', actionEntityId: 'control:next', toPageId: null },
      { fromPageId: 'page:a', actionEntityId: 'control:next', toPageId: 'page:b' }
    ]
  }), /competing transition/i);

  assert.throws(() => normalizeReplayFixture({
    version: 1, workflowId: 'wf:1', startPageId: 'page:a',
    pages: [{ pageId: 'page:a', snapshot: snapshot() }, { pageId: 'page:b', snapshot: snapshot('/b', 'B') }],
    transitions: [
      { fromPageId: 'page:a', actionEntityId: 'control:x', toPageId: null },
      { fromPageId: 'page:b', actionEntityId: 'control:y', toPageId: null }
    ]
  }), /single frontier/i);
});

test('rejects runtime-shaped keys recursively', () => {
  const forbidden = ['value', 'values', 'instance', 'instances', 'cookie', 'cookies', 'author' + 'ization', 'to' + 'ken', 'pass' + 'word', 'sec' + 'ret'];
  for (const key of forbidden) {
    assert.throws(() => normalizeReplayFixture({
      version: 1, workflowId: 'wf:1', startPageId: 'page:a',
      pages: [{ pageId: 'page:a', snapshot: { ...snapshot(), root: { tag: 'body', attributes: {}, directText: '', children: [{ tag: 'div', attributes: {}, directText: '', children: [], nested: { [key]: 'blocked' } }] } } }],
      transitions: []
    }), new RegExp(key, 'i'));
  }
});

test('validates page and transition shapes directly', () => {
  const page = { pageId: 'page:a', snapshot: snapshot() };
  assert.deepEqual(validateReplayPage(page), page);
  assert.throws(() => validateReplayPage({ pageId: 'page:a', snapshot: { ...snapshot(), html: '<input>' } }), /html/i);

  const transition = { fromPageId: 'page:a', actionEntityId: 'control:next', toPageId: null };
  assert.deepEqual(validateReplayTransition(transition), transition);
  assert.throws(() => validateReplayTransition({ ...transition, toPageId: 42 }), /toPageId/i);
});
