import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadEntityGraph,
  loadInstanceGraph,
  saveEntityGraph,
  saveInstanceGraph
} from '../src/graph/graphStore.js';

test('entity and instance arrays persist independently', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-graph-'));
  t.after(async () => fs.rm(dir, { recursive: true, force: true }));
  const entityFile = path.join(dir, 'entities.json');
  const instanceFile = path.join(dir, 'instances.json');

  await saveEntityGraph(entityFile, [{ id: 'page:1', name: 'Page', type: 'page', structural: {}, semantic: {}, links: [] }]);
  await saveInstanceGraph(instanceFile, [{ id: 'instance:1', type: 'instance', value: 'A', links: [{ id: 'field:1', relationship: 'instanceOf' }] }]);

  const entities = await loadEntityGraph(entityFile);
  const instances = await loadInstanceGraph(instanceFile);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].id, 'page:1');
  assert.equal(instances.length, 1);
  assert.equal(instances[0].value, 'A');
});

test('missing graph files load as empty arrays', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-graph-'));
  const entities = await loadEntityGraph(path.join(dir, 'missing-entities.json'));
  const instances = await loadInstanceGraph(path.join(dir, 'missing-instances.json'));
  await fs.rm(dir, { recursive: true, force: true });
  assert.deepEqual(entities, []);
  assert.deepEqual(instances, []);
});
