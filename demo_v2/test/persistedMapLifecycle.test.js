import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { withMapPersistence } from '../server/explorer/mapPersistence.js';
import { withPersistedMap } from '../server/explorer/persistedMap.js';

class BaseExplorer {
  constructor({ dataRoot, topology = {} }) {
    this.dataRoot = dataRoot;
    this.topology = topology;
    this.state = this.emptyState();
  }

  emptyState() {
    return {
      status: 'idle', repoUrl: '', commit: '', currentArtifact: null,
      frontier: [], executionStack: [], pass1Arcs: [], semanticObjects: {},
      tokenUsage: { prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 },
      lastMessage: ''
    };
  }

  snapshot() { return JSON.parse(JSON.stringify(this.state)); }
  emit() {}
  async run(repoUrl) {
    this.state = this.emptyState();
    this.state.status = 'preparing';
    this.state.repoUrl = repoUrl;
    return this.snapshot();
  }
}

const PersistedExplorer = withPersistedMap(withMapPersistence(BaseExplorer));

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lemap-lifecycle-')); }

function restoredState(explorer, repoUrl = 'https://example.test/repo') {
  return {
    ...explorer.emptyState(),
    status: 'complete', repoUrl, commit: 'abc123',
    pass1Arcs: [{ id: 'arc-1', title: 'Existing workflow', progress: 100, closureState: 'closed' }],
    semanticObjects: { workflow: { id: 'workflow', type: 'workflow', name: 'Existing workflow' } },
    mapPersistence: { restored: true, savedAt: '2026-08-31T00:00:00Z', repoUrl, commit: 'abc123', version: 3 }
  };
}

test('starting Learn for the same repository keeps the restored map visible while preparing', async () => {
  const explorer = new PersistedExplorer({ dataRoot: tempRoot(), topology: {} });
  explorer.state = restoredState(explorer);

  const snapshot = await explorer.run('https://example.test/repo');

  assert.equal(snapshot.status, 'preparing');
  assert.equal(snapshot.pass1Arcs.length, 1);
  assert.equal(snapshot.pass1Arcs[0].title, 'Existing workflow');
  assert.ok(snapshot.semanticObjects.workflow);
});

test('loading a persisted map schedules runtime hydration on application startup', async () => {
  const dataRoot = tempRoot();
  const maps = path.join(dataRoot, 'semantic-maps');
  fs.mkdirSync(maps, { recursive: true });
  fs.writeFileSync(path.join(maps, 'saved.json'), JSON.stringify({
    version: 2,
    repoUrl: 'https://example.test/repo',
    commit: 'abc123',
    savedAt: '2026-08-31T00:00:00Z',
    semanticState: {
      status: 'complete', repoUrl: 'https://example.test/repo', commit: 'abc123',
      pass1Arcs: [{ id: 'arc-1', title: 'Existing workflow' }], semanticObjects: {},
      frontier: [], executionStack: [], stopRequested: false
    }
  }));

  class HydratingExplorer extends PersistedExplorer {
    async refreshSchemaCatalogForCurrentMap() {
      this.hydrationCalls = Number(this.hydrationCalls || 0) + 1;
      return { refreshed: true };
    }
  }

  const explorer = new HydratingExplorer({ dataRoot, topology: {} });
  assert.ok(explorer.startupHydration instanceof Promise);
  await explorer.startupHydration;
  assert.equal(explorer.hydrationCalls, 1);
  assert.equal(explorer.state.pass1Arcs[0].title, 'Existing workflow');
});
