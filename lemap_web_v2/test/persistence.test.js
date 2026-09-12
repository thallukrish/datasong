import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEntityGraph } from '../src/graph/entityGraph.js';
import { createInstanceGraph, upsertInstance } from '../src/graph/instanceGraph.js';
import { createWorkflow, appendWorkflowStep } from '../src/workflow/workflowTraversal.js';
import {
  loadEntityGraph,
  saveEntityGraph,
  loadInstanceGraph,
  saveInstanceGraph,
  loadWorkflow,
  saveWorkflow,
  workflowFilePath
} from '../src/storage/persistence.js';

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'lemap-web-v2-'));
}

function sampleEntity() {
  return {
    id: 'control:income',
    type: 'ui_control',
    name: 'Income',
    structural: { controlType: 'text' },
    semantic: { meaning: 'gross income' },
    links: []
  };
}

test('entity graph round-trips through JSON persistence', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'nested', 'entity.json');
  const graph = createEntityGraph({ entities: [sampleEntity()] });

  await saveEntityGraph(file, graph);
  const loaded = await loadEntityGraph(file);

  assert.deepEqual(loaded, graph);
});

test('missing entity and instance graph files load as empty graphs', async () => {
  const dir = await tempDir();
  const entityGraph = await loadEntityGraph(path.join(dir, 'missing-entity.json'));
  const instanceGraph = await loadInstanceGraph(path.join(dir, 'missing-instance.json'));

  assert.deepEqual(entityGraph, { version: 1, entities: [] });
  assert.deepEqual(instanceGraph, { version: 1, instances: [] });
});

test('instance graph round-trips runtime values locally', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'instance.json');
  const graph = createInstanceGraph();
  upsertInstance(graph, { entityId: 'control:income', value: '1250' });

  await saveInstanceGraph(file, graph);
  const loaded = await loadInstanceGraph(file);

  assert.deepEqual(loaded, graph);
});

test('workflow round-trips with repeated page visits and cursor intact', async () => {
  const dir = await tempDir();
  const workflow = createWorkflow({ id: 'workflow:itr-3', originalQuestion: 'File my return' });
  appendWorkflowStep(workflow, { pageEntityId: 'page:a', frameId: 'frame:1' });
  appendWorkflowStep(workflow, { pageEntityId: 'page:b', enteredViaLinkEntityId: 'next:1', frameId: 'frame:2' });
  appendWorkflowStep(workflow, { pageEntityId: 'page:a', frameId: 'frame:3' });

  await saveWorkflow(dir, workflow);
  const loaded = await loadWorkflow(dir, workflow.id);

  assert.deepEqual(loaded, workflow);
});

test('workflow ids are converted to safe deterministic filenames', () => {
  const file = workflowFilePath('data/workflows', 'workflow:itr/3?fy=2026');
  assert.equal(path.dirname(file), path.normalize('data/workflows'));
  assert.match(path.basename(file), /^workflow-itr-3-fy-2026-[a-f0-9]{10}\.json$/);
});

test('malformed persisted JSON is rejected instead of silently resetting state', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'entity.json');
  await fs.writeFile(file, '{bad json', 'utf8');

  await assert.rejects(() => loadEntityGraph(file), /parse persisted json/i);
});

test('workflow loader returns null when that workflow has never been persisted', async () => {
  const dir = await tempDir();
  assert.equal(await loadWorkflow(dir, 'workflow:missing'), null);
});
