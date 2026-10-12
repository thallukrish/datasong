import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzePythonRepository } from '../server/languages/python/adapter.js';

test('Python flow-derived entity follows a record through call parameters', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-flow-entity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'pipeline.py'), `
def save(record):
    return record["name"]

def normalize(record):
    record["value"] = record["value"] + 1
    return save(record)

def load():
    record = {"name": "a", "value": 1}
    return normalize(record)

def run():
    return load()
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['pipeline.py'] });
  const nodes = result.dataGraphNodes || [];
  const entities = nodes.filter((node) => node.type === 'entity');

  const record = entities.find((node) =>
    node.details?.kind === 'mapping' &&
    node.details?.keys?.includes("'name'") &&
    node.details?.keys?.includes("'value'")
  );

  assert.ok(record, 'Expected one flow-derived record entity');
  assert.equal(record.details.identityScope, 'flow');
  assert.ok(record.details.functionCount >= 3);
  assert.ok(record.details.flowCount >= 1);
  assert.ok(record.details.persistenceScore > 0);
  assert.ok(record.details.aliases.includes('record'));

  const links = result.entityLinks || [];
  assert.ok(links.some((link) => link.targetId === record.id && link.relationship === 'create'));
  assert.ok(links.some((link) => link.targetId === record.id && link.relationship === 'update'));
  assert.ok(links.some((link) => link.targetId === record.id && link.relationship === 'read'));

  const functionNodes = nodes.filter((node) => node.type === 'function');
  const byName = new Map(functionNodes.map((node) => [node.details?.name, node]));
  assert.ok(byName.get('run')?.links.some((link) => link.relationship === 'calls' && link.id === byName.get('load')?.id));
  assert.ok(byName.get('load')?.links.some((link) => link.relationship === 'calls' && link.id === byName.get('normalize')?.id));
  assert.ok(byName.get('normalize')?.links.some((link) => link.relationship === 'calls' && link.id === byName.get('save')?.id));
});

test('Python flow-derived entities do not merge disconnected same-name locals', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-flow-scope-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'scope.py'), `
def left():
    chunk = source.left()
    return chunk.shape

def right():
    chunk = source.right()
    return chunk.dtype
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['scope.py'] });
  const chunkEntities = (result.dataGraphNodes || []).filter((node) =>
    node.type === 'entity' && node.details?.aliases?.includes('chunk')
  );

  assert.equal(chunkEntities.length, 2);
  assert.ok(chunkEntities.every((node) => node.details?.functionCount === 1));
  assert.notEqual(chunkEntities[0].id, chunkEntities[1].id);
});

test('Python flow-derived entities retain scalar values that cross function boundaries', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-flow-scalar-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'scalar.py'), `
def source():
    value: int = 3
    return value

def consume(number: int):
    return number + 1

def run():
    result = source()
    return consume(result)
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['scalar.py'] });
  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'entity');
  const scalar = entities.find((node) =>
    node.details?.aliases?.includes('value') &&
    node.details?.aliases?.includes('result') &&
    node.details?.aliases?.includes('number')
  );

  assert.ok(scalar, 'Expected scalar lineage across return/receiver and argument/parameter');
  assert.equal(scalar.details.identityScope, 'flow');
  assert.ok(scalar.details.functionCount >= 3);
  assert.ok(scalar.details.annotations.includes('int'));
});

test('Python entity operations attach to the innermost AST region', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-flow-region-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'region.py'), `
def sink(record):
    return record["value"]

def update(record):
    if record["enabled"]:
        record["value"] = record["value"] + 1
    return sink(record)
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['region.py'] });
  const updateSymbol = (result.symbols || []).find((symbol) => symbol.name === 'update');
  const ifRegion = (updateSymbol?.regions || []).find((region) => region.kind === 'if');
  const relation = (result.entityLinks || []).find((link) =>
    link.functionId === updateSymbol?.id &&
    link.relationship === 'update' &&
    link.variable === 'record'
  );

  assert.ok(updateSymbol);
  assert.ok(ifRegion);
  assert.ok(relation);
  assert.equal(relation.sourceId, ifRegion.id);
  assert.equal(relation.sourceType, 'function-region');
  assert.equal(relation.regionId, ifRegion.id);
  assert.ok(relation.startLine >= ifRegion.startLine);
  assert.ok(relation.endLine <= ifRegion.endLine);
});
