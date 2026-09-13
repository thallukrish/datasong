import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadReplayFixture,
  saveReplayFixture,
  upsertReplayPage,
  upsertReplayTransition
} from '../src/fixtureStore.js';

function snapshot(url = '/a', title = 'A') {
  return { version: 1, url, title, root: { tag: 'body', attributes: {}, directText: '', children: [] } };
}

function fixture() {
  return {
    version: 1,
    workflowId: 'wf:1',
    startPageId: 'page:a',
    pages: [{ pageId: 'page:a', snapshot: snapshot() }],
    transitions: [{ fromPageId: 'page:a', actionEntityId: 'control:next', toPageId: null }]
  };
}

test('save then load preserves the canonical replay fixture', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-replay-'));
  const file = path.join(dir, 'fixture.json');
  try {
    const saved = await saveReplayFixture(file, fixture());
    const loaded = await loadReplayFixture(file);
    assert.deepEqual(loaded, saved);
    assert.deepEqual(loaded.frontier, { fromPageId: 'page:a', actionEntityId: 'control:next' });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('transition upsert replaces an existing unknown transition with a known destination', () => {
  const withPageB = upsertReplayPage(fixture(), {
    pageId: 'page:b',
    snapshot: snapshot('/b', 'B')
  });
  const updated = upsertReplayTransition(withPageB, {
    fromPageId: 'page:a',
    actionEntityId: 'control:next',
    toPageId: 'page:b'
  });

  assert.equal(updated.transitions.length, 1);
  assert.equal(updated.transitions[0].toPageId, 'page:b');
  assert.equal(updated.frontier, null);
});

test('page upsert is idempotent by pageId and replaces the page payload', () => {
  const original = fixture();
  const updated = upsertReplayPage(original, {
    pageId: 'page:a',
    snapshot: snapshot('/a2', 'A2')
  });

  assert.equal(updated.pages.length, 1);
  assert.equal(updated.pages[0].snapshot.url, '/a2');
  assert.equal(original.pages[0].snapshot.url, '/a');
});

test('load returns null when the replay fixture does not exist', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-replay-'));
  const file = path.join(dir, 'missing.json');
  try {
    assert.equal(await loadReplayFixture(file), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('saving rejects runtime values before anything is written', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-replay-'));
  const file = path.join(dir, 'fixture.json');
  try {
    const unsafe = fixture();
    unsafe.pages[0].snapshot.root.children.push({
      tag: 'input', attributes: {}, directText: '', children: [], instance: { field: 'blocked' }
    });
    await assert.rejects(() => saveReplayFixture(file, unsafe), /instance/i);
    await assert.rejects(() => fs.access(file));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
