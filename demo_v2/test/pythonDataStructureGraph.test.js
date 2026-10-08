import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzePythonRepository } from '../server/languages/python/adapter.js';

test('Python indexing emits a flat data-structure graph joined to existing call flow', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-data-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'pipeline.py'), `
def load():
    record = {"name": "a", "value": 1}
    return record

def normalize(record):
    record["value"] = record["value"] + 1
    return record

def save(record):
    return record["name"]

def run():
    record = load()
    record = normalize(record)
    return save(record)
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['pipeline.py'] });
  const nodes = result.dataGraphNodes || [];

  assert.ok(nodes.length > 0);
  assert.ok(nodes.every((node) =>
    typeof node.id === 'string' &&
    typeof node.type === 'string' &&
    node.details &&
    Array.isArray(node.links) &&
    node.links.every((link) => typeof link.id === 'string' && typeof link.relationship === 'string')
  ));

  const entityNodes = nodes.filter((node) => node.type === 'data-structure');
  const sharedRecord = entityNodes.find((node) =>
    node.details?.kind === 'mapping' &&
    node.details?.keys?.includes("'name'") &&
    node.details?.keys?.includes("'value'")
  );

  assert.ok(sharedRecord);
  assert.ok(sharedRecord.details.functionCount >= 3);
  assert.ok(sharedRecord.details.coreScore >= sharedRecord.details.functionCount);

  const normalize = nodes.find((node) => node.type === 'function' && node.details?.name === 'normalize');
  const save = nodes.find((node) => node.type === 'function' && node.details?.name === 'save');
  const run = nodes.find((node) => node.type === 'function' && node.details?.name === 'run');

  assert.ok(normalize?.links.some((link) => link.id === sharedRecord.id && /modifies|reads/.test(link.relationship)));
  assert.ok(save?.links.some((link) => link.id === sharedRecord.id && /reads/.test(link.relationship)));
  assert.ok(run?.links.some((link) => link.relationship === 'calls' && link.id === normalize.id));
  assert.ok(run?.links.some((link) => link.relationship === 'calls' && link.id === save.id));
});

test('Python data-structure graph ignores imported module aliases and primitive locals', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-data-noise-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'sample.py'), `
import math

def compute(value: int):
    count = value + 1
    result = math.floor(count)
    return result
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['sample.py'] });
  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'data-structure');

  assert.ok(!entities.some((node) => node.details?.aliases?.includes('math')));
  assert.ok(!entities.some((node) => node.details?.aliases?.includes('count')));
});
