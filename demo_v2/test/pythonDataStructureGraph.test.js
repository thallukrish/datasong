import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzePythonRepository } from '../server/languages/python/adapter.js';

async function tempRepo(t, name, source) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), name));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'sample.py'), source);
  return analyzePythonRepository({ repoDir: root, files: ['sample.py'] });
}

test('anonymous data qualifies only through continuous cross-function lineage', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-continuous-', `
def sink(item):
    return item["name"]

def normalize(x):
    x["value"] = x["value"] + 1
    return sink(x)

def load():
    record = {"name": "a", "value": 1}
    return normalize(record)
`);

  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'entity');
  const record = entities.find((node) =>
    node.details?.identityKind === 'continuous' &&
    node.details?.keys?.includes("'name'") &&
    node.details?.keys?.includes("'value'")
  );

  assert.ok(record, 'Expected continuous mapping entity');
  assert.ok(record.details.functionCount >= 3);
  assert.equal(record.details.classId, '');
  assert.ok(record.details.aliases.includes('record'));
  assert.ok(record.details.aliases.includes('x'));
  assert.ok(record.details.aliases.includes('item'));

  const links = result.entityLinks || [];
  assert.ok(links.some((link) => link.targetId === record.id && link.relationship === 'create'));
  assert.ok(links.some((link) => link.targetId === record.id && link.relationship === 'update'));
  assert.ok(links.some((link) => link.targetId === record.id && link.relationship === 'read'));
});

test('disconnected same-shape mappings remain local structures', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-mapping-local-', `
def second():
    right = {"name": "b", "value": 2}
    return right["name"]

def first():
    left = {"name": "a", "value": 1}
    return second()
`);

  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'entity');
  assert.ok(!entities.some((node) =>
    node.details?.keys?.includes("'name'") &&
    node.details?.keys?.includes("'value'")
  ));
});

test('same resolved class in separate functions of one flow qualifies as a class entity', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-class-', `
class Dataset:
    def __init__(self):
        self.attrs = {}
        self.variables = {}

def finish():
    ds = Dataset()
    return ds.variables

def middle():
    return finish()

def start():
    ds = Dataset()
    ds.attrs["mode"] = "x"
    return middle()
`);

  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'entity');
  const dataset = entities.find((node) =>
    node.details?.identityKind === 'class' &&
    node.details?.name === 'Dataset'
  );

  assert.ok(dataset, 'Expected Dataset class-backed entity');
  assert.ok(dataset.details.classId);
  assert.ok(dataset.details.functionCount >= 2);
  assert.ok(dataset.details.members.includes('attrs'));
  assert.ok(dataset.details.members.includes('variables'));
});

test('class instance used in only one function stays local', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-class-local-', `
class Dataset:
    def __init__(self):
        self.attrs = {}

def helper():
    return 1

def start():
    ds = Dataset()
    ds.attrs["mode"] = "x"
    return helper()
`);

  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'entity');
  assert.ok(!entities.some((node) => node.details?.name === 'Dataset'));
});

test('same-named disconnected locals never establish entity identity', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-same-name-', `
def right():
    chunk = source.right()
    return chunk.dtype

def left():
    chunk = source.left()
    return right()
`);

  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'entity');
  assert.ok(!entities.some((node) => node.details?.aliases?.includes('chunk')));
});

test('entity operations still attach to the innermost AST region', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-region-', `
def sink(record):
    return record["value"]

def update(record):
    if record["enabled"]:
        record["value"] = record["value"] + 1
    return sink(record)
`);

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
