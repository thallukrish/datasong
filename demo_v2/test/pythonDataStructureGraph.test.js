import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzePythonRepository } from '../server/languages/python/adapter.js';
import { buildCompactCallFlows } from '../server/semantics/code/compactCallFlows.js';
import { buildPythonDataStructureGraph } from '../server/languages/python/dataStructureGraph.js';

async function tempRepo(t, name, source) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), name));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'sample.py'), source);

  const raw = await analyzePythonRepository({ repoDir: root, files: ['sample.py'] });
  const flows = buildCompactCallFlows({ symbols: raw.symbols || [] });
  const entities = buildPythonDataStructureGraph({
    symbols: raw.symbols || [],
    observations: raw.dataObservations || [],
    transfers: raw.dataTransfers || [],
    flowSlices: flows.paths || [],
    codeFacts: raw.codeFacts || [],
    externalSymbols: raw.externalSymbols || []
  });

  return {
    ...raw,
    compactFlows: flows.paths || [],
    dataGraphNodes: entities.nodes || [],
    entityLinks: entities.entityLinks || []
  };
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
    node.details?.keys?.includes('name') &&
    node.details?.keys?.includes('value')
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
    node.details?.keys?.includes('name') &&
    node.details?.keys?.includes('value')
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


test('typing containers never establish class entity identity', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-typing-container-', `
from typing import Mapping, Dict

def finish(x: Mapping[str, int]):
    return x["value"]

def start():
    item: Dict[str, int] = {"value": 1}
    return finish(item)
`);

  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'entity');
  assert.ok(!entities.some((node) =>
    String(node.details?.classId || '').includes('typing.Mapping') ||
    String(node.details?.classId || '').includes('typing.Dict')
  ));

  const traced = entities.find((node) =>
    node.details?.identityKind === 'continuous' &&
    node.details?.keys?.includes('value')
  );
  assert.ok(traced, 'Expected continuously traced mapping entity');
  assert.equal(traced.details.classId, '');
});

test('concrete imported classes may establish external class identity', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-external-class-', `
from externalpkg import ConcreteThing

def finish(x: ConcreteThing):
    return x.value

def start():
    item = ConcreteThing()
    return finish(item)
`);

  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'entity');
  const external = entities.find((node) =>
    node.details?.identityKind === 'class' &&
    node.details?.classScope === 'external' &&
    String(node.details?.classId || '').includes('externalpkg.ConcreteThing')
  );

  assert.ok(external, 'Expected concrete imported class entity');
  assert.ok(external.details.functionCount >= 2);
});


test('imported modules alone never establish class identity', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-module-alias-', `
import typing

def finish(x: typing.Mapping[str, int]):
    return x["value"]

def start():
    item: typing.Mapping[str, int] = {"value": 1}
    return finish(item)
`);

  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'entity');
  assert.ok(!entities.some((node) =>
    String(node.details?.classId || '') === 'external-class:typing'
  ));

  const traced = entities.find((node) =>
    node.details?.identityKind === 'continuous' &&
    node.details?.keys?.includes('value')
  );
  assert.ok(traced, 'Expected continuously traced mapping entity');
});

test('module aliases resolve to canonical concrete external classes', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-module-class-', `
import pandas as pd

def finish(x: pd.Index):
    return x.name

def start():
    item = pd.Index([1, 2, 3])
    return finish(item)
`);

  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'entity');
  const external = entities.find((node) =>
    node.details?.identityKind === 'class' &&
    node.details?.classScope === 'external' &&
    node.details?.classId === 'external-class:pandas.Index'
  );

  assert.ok(external, 'Expected pd.Index to canonicalize to pandas.Index');
  assert.ok(external.details.functionCount >= 2);
});


test('primitive scalar values passed across functions do not materialize as entities', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-scalars-', `
def sink_int(x: int):
    return x + 1

def sink_str(x: str):
    return x.upper()

def start():
    count: int = 1
    label: str = "x"
    sink_int(count)
    return sink_str(label)
`);

  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'entity');
  assert.equal(entities.length, 0);
});

test('date and time scalar values passed across functions do not materialize as entities', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-dates-', `
import datetime

def sink(value: datetime.date):
    return value.year

def start():
    value = datetime.date.today()
    return sink(value)
`);

  const entities = (result.dataGraphNodes || []).filter((node) => node.type === 'entity');
  assert.ok(!entities.some((node) =>
    String(node.details?.classId || '').endsWith('datetime.date') ||
    node.details?.aliases?.includes('value')
  ));
});


test('entity fingerprints retain structured writes and post-read processing', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-fingerprint-', `
def consume(value):
    return value + 1

def finish(record):
    return consume(record["value"])

def start():
    record = {"value": 1}
    record["value"] = record["value"] + 2
    return finish(record)
`);

  const entity = (result.dataGraphNodes || []).find((node) =>
    node.details?.identityKind === 'continuous' &&
    node.details?.keys?.includes('value')
  );

  assert.ok(entity, 'Expected continuously traced mapping entity');
  const signatures = entity.details?.accessSignatures || [];
  assert.ok(signatures.some((item) =>
    item.relationship === 'update' &&
    item.access === 'key' &&
    item.name === 'value' &&
    String(item.valueKind || '').startsWith('binop:')
  ));
  assert.ok(signatures.some((item) =>
    item.relationship === 'read' &&
    item.access === 'key' &&
    item.name === 'value' &&
    String(item.afterRead || '').length > 0
  ));
});


test('structured collections retain element shape for entity discovery', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-element-shape-', `
def finish(items):
    return items[0]["name"]

def start():
    records = [
        {"name": "a", "value": 1},
        {"name": "b", "value": 2}
    ]
    return finish(records)
`);

  const entity = (result.dataGraphNodes || []).find((node) =>
    node.details?.identityKind === 'continuous' &&
    node.details?.aliases?.includes('records') &&
    node.details?.aliases?.includes('items')
  );

  assert.ok(entity, 'Expected continuously traced collection entity');
  assert.ok(entity.details?.elementKinds?.includes('mapping'));
  assert.ok(entity.details?.elementKeys?.includes('name'));
  assert.ok(entity.details?.elementKeys?.includes('value'));
});


test('only literal string map keys contribute to structural shape identity', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-literal-map-keys-', `
def finish(record, key):
    a = record["name"]
    b = record[key]
    c = record[0]
    d = record[-1]
    e = record[1:]
    return a

def start():
    record = {"name": "a", "value": 1}
    return finish(record, "value")
`);

  const entity = (result.dataGraphNodes || []).find((node) =>
    node.details?.identityKind === 'continuous' &&
    node.details?.aliases?.includes('record')
  );

  assert.ok(entity, 'Expected continuously traced mapping entity');
  assert.ok(entity.details?.keys?.includes('name'));
  assert.ok(entity.details?.keys?.includes('value'));
  assert.ok(!entity.details?.keys?.includes('key'));
  assert.ok(!entity.details?.keys?.includes('0'));
  assert.ok(!entity.details?.keys?.includes('-1'));
  assert.ok(!entity.details?.keys?.includes('1:'));
});

test('method invocation does not become object attribute identity evidence', async (t) => {
  const result = await tempRepo(t, 'lemap-entity-method-vs-attribute-', `
def finish(obj):
    obj.close()
    return obj.encoding

def start(obj):
    obj.load()
    return finish(obj)
`);

  const observation = (result.dataObservations || []).find((item) =>
    item.variable === 'obj' &&
    item.functionName?.endsWith('finish')
  );

  assert.ok(observation, 'Expected object observation');
  assert.ok(observation.members?.includes('encoding'));
  assert.ok(!observation.members?.includes('close'));
  assert.ok(observation.methods?.includes('close'));
});
