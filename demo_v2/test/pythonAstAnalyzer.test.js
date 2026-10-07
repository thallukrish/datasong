import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzePythonRepository } from '../server/languages/python/adapter.js';
import { CodeTopology } from '../server/topology.js';

test('Python AST analyzer resolves imported classes, instances, self calls and local inheritance', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-ast-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'worker.py'), `
class Base:
    def normalize(self, value):
        return value.strip()

class Worker(Base):
    def __init__(self):
        self.ready = True

    def run(self, value):
        return self.normalize(value)
`);
  await fs.writeFile(path.join(root, 'main.py'), `
from worker import Worker

def main():
    worker = Worker()
    return worker.run(" x ")

if __name__ == "__main__":
    main()
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['main.py', 'worker.py'] });
  const symbols = result.symbols || [];
  const byName = new Map(symbols.map((symbol) => [symbol.name, symbol]));

  assert.equal(byName.get('main')?.entryPoint, true);
  assert.ok(byName.get('main')?.references.some((ref) => ref.targetSymbolId === byName.get('Worker.__init__')?.id));
  assert.ok(byName.get('main')?.references.some((ref) => ref.targetSymbolId === byName.get('Worker.run')?.id));
  assert.ok(byName.get('Worker.run')?.references.some((ref) => ref.targetSymbolId === byName.get('Base.normalize')?.id));
});

test('Python AST analyzer preserves imported external calls', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-external-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'main.py'), `
from pydantic.fields import Field

def build():
    return Field(default="x", initial=lambda: "y")
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['main.py'] });
  const build = (result.symbols || []).find((symbol) => symbol.name === 'build');
  const ref = build?.references.find((item) => item.name === 'Field');

  assert.equal(ref?.resolution, 'external_import');
  assert.equal(ref?.qualifiedName, 'pydantic.fields.Field');
  assert.deepEqual(ref?.keywordArgs, ['default', 'initial']);
});

test('Python AST analyzer emits flat structural code facts with parent-child identity', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-facts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'main.py'), `
def foobar(a, b):
    value = helper(a)
    if value:
        return b
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['main.py'] });
  assert.equal(result.version, 12);
  assert.equal(result.constructs, undefined);

  const facts = result.codeFacts || [];
  const fn = facts.find((item) => item.type === 'function' && item.name === 'foobar');
  const a = facts.find((item) => item.type === 'input_param' && item.name === 'a');
  const b = facts.find((item) => item.type === 'input_param' && item.name === 'b');
  const assignment = facts.find((item) => item.type === 'assignment' && item.name === 'value');
  const call = facts.find((item) => item.type === 'call' && item.name === 'helper');
  const region = facts.find((item) => item.type === 'if');

  assert.ok(fn);
  assert.equal(a?.parentFactId, fn.factId);
  assert.equal(b?.parentFactId, fn.factId);
  const straight = facts.find((item) => item.type === 'region' && item.startLine === assignment?.startLine);
  assert.ok(straight);
  assert.equal(assignment?.parentFactId, straight.factId);
  assert.equal(call?.parentFactId, straight.factId);
  assert.ok(region?.name.startsWith('foobar_region_'));
  assert.ok(fn.childFactIds.includes(a.factId));
  assert.ok(fn.childFactIds.includes(b.factId));
});

test('Python AST analyzer groups straight-line statements into function and module regions', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-regions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'main.py'), `
CONFIG = {}
LIMIT = 10

def build(x):
    value = x + 1
    doubled = value * 2
    if doubled:
        result = doubled
        return result
    final = 0
    return final
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['main.py'] });
  const build = (result.symbols || []).find((symbol) => symbol.name === 'build');
  const blocks = (build?.regions || []).filter((region) => region.kind === 'region');
  const conditional = (build?.regions || []).find((region) => region.kind === 'if');

  assert.ok(build);
  assert.ok(blocks.some((region) => /value = x \+ 1/.test(region.body) && /doubled = value \* 2/.test(region.body)));
  assert.ok(conditional);
  assert.ok(!blocks.some((region) => region.parentRegionId === conditional.id));
  assert.ok(blocks.some((region) => /final = 0/.test(region.body) && /return final/.test(region.body)));

  const file = (result.moduleRegions || []).find((item) => item.sourcePath === 'main.py');
  assert.ok(file);
  assert.ok((file.regions || []).some((region) =>
    region.kind === 'region' &&
    /CONFIG = \{\}/.test(region.body) &&
    /LIMIT = 10/.test(region.body)
  ));
});

test('Python structural CSV materializes straight-line region rows with containment', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-region-csv-'));
  const repoDir = path.join(root, 'repo');
  const cacheRoot = path.join(root, 'cache');
  await fs.mkdir(repoDir, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(repoDir, 'main.py'), `
CONFIG = 1
LIMIT = 2

def build(x):
    value = x + 1
    doubled = value * 2
    if doubled:
        result = helper(doubled)
    final = doubled
    return final
`);

  const topology = new CodeTopology({ cacheRoot });
  topology.repoDir = repoDir;
  topology.repoUrl = 'https://example.invalid/regions.git';
  topology.files = ['main.py'];
  topology.commit = 'cccccccccccccccccccccccccccccccccccccccc';

  await topology.buildConstructIndex();

  const rows = topology.codeStructureRows;
  const moduleRegion = rows.find((row) => row.type === 'region' && row.line_range === '2-3');
  const functionRegion = rows.find((row) => row.type === 'region' && row.line_range === '6-7');
  const ifRow = rows.find((row) => row.type === 'if');
  const nestedRegion = rows.find((row) => row.type === 'region' && row.line_range === '9');
  const trailingRegion = rows.find((row) => row.type === 'region' && row.line_range === '10-11');
  const buildRow = rows.find((row) => row.type === 'function' && row.name === 'build');
  const valueRow = rows.find((row) => row.type === 'assignment' && row.name === 'value');
  const helperCall = rows.find((row) => row.type === 'call' && row.name === 'helper');

  assert.ok(moduleRegion);
  assert.equal(moduleRegion.parent, '');
  assert.ok(functionRegion);
  assert.equal(functionRegion.parent, buildRow.row);
  assert.equal(valueRow.parent, functionRegion.row);
  assert.equal(ifRow.parent, buildRow.row);
  assert.equal(nestedRegion, undefined);
  assert.equal(trailingRegion.parent, buildRow.row);
  assert.equal(rows.find((row) => row.type === 'assignment' && row.name === 'result').parent, ifRow.row);
  assert.equal(helperCall.parent, ifRow.row);
});

test('CodeTopology persists structural CSV with JSON-array relation cells', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-structure-csv-'));
  const repoDir = path.join(root, 'repo');
  const cacheRoot = path.join(root, 'cache');
  await fs.mkdir(repoDir, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(repoDir, 'main.py'), `
def child(x):
    return x

def parent(a, b):
    return child(a)
`);

  const topology = new CodeTopology({ cacheRoot });
  topology.repoDir = repoDir;
  topology.repoUrl = 'https://example.invalid/demo.git';
  topology.files = ['main.py'];
  topology.commit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  await topology.buildConstructIndex();

  assert.ok(topology.constructIndexMeta?.csvPath);
  assert.ok(Number(topology.constructIndexMeta?.csvRowCount || 0) > 0);
  const csv = await fs.readFile(topology.constructIndexMeta.csvPath, 'utf8');
  assert.match(csv, /^row,file,line_range,type,name,parent,children,callers,callees/m);
  assert.match(csv, /,function,parent,/);
  assert.match(csv, /,input_param,a,/);
  assert.match(csv, /"\[""[0-9]+""/);

  const uniqueIndex = JSON.parse(await fs.readFile(topology.constructIndexMeta.uniqueIndexPath, 'utf8'));
  const valuesIndex = JSON.parse(await fs.readFile(topology.constructIndexMeta.valuesIndexPath, 'utf8'));
  assert.equal(uniqueIndex.row, undefined);
  assert.equal(valuesIndex.row, undefined);
  assert.ok(uniqueIndex.type.includes('function'));
  assert.ok(uniqueIndex.name.includes('parent'));
  assert.equal(uniqueIndex.function, undefined);
  assert.ok(valuesIndex.type.some((entry) => entry[1] === 'function'));
  assert.ok(valuesIndex.name.some((entry) => entry[1] === 'parent'));
  assert.equal(valuesIndex.function, undefined);

  const parentRow = topology.codeStructureRows.find((row) => row.type === 'function' && row.name === 'parent');
  const childRow = topology.codeStructureRows.find((row) => row.type === 'function' && row.name === 'child');
  assert.ok(parentRow);
  assert.ok(childRow);
  assert.ok(uniqueIndex.callees.includes(String(childRow.row)));
  assert.ok(valuesIndex.callees.some((entry) => entry[1] === String(childRow.row)));
  assert.ok(uniqueIndex.callers.includes(String(parentRow.row)));
  assert.ok(valuesIndex.callers.some((entry) => entry[1] === String(parentRow.row)));
});

test('CodeTopology reuses same-commit structural CSV cache without a duplicated AST snapshot', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-structure-cache-'));
  const repoDir = path.join(root, 'repo');
  const cacheRoot = path.join(root, 'cache');
  await fs.mkdir(repoDir, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(repoDir, 'main.py'), 'def build(x):\n    return x\n');

  const topology = new CodeTopology({ cacheRoot });
  topology.repoDir = repoDir;
  topology.repoUrl = 'https://example.invalid/demo.git';
  topology.files = ['main.py'];
  topology.commit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  await topology.buildConstructIndex();
  assert.equal(topology.constructIndexMeta?.reused, false);

  const csvPath = topology.constructIndexMeta.csvPath;
  const metaPath = topology.constructIndexMeta.metaPath;
  const legacyPath = path.join(path.dirname(metaPath), 'python.json');

  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  assert.equal(meta.commit, topology.commit);
  assert.equal(meta.csvRowCount, topology.codeStructureRows.length);
  assert.equal(meta.codeFacts, undefined);
  assert.equal(meta.analysis, undefined);
  await assert.rejects(fs.readFile(legacyPath, 'utf8'));
  await fs.access(topology.constructIndexMeta.uniqueIndexPath);
  await fs.access(topology.constructIndexMeta.valuesIndexPath);

  topology.pythonAnalysis = null;
  topology.codeStructureRows = [];
  topology.palUniqueIndex = null;
  topology.palValuesIndex = null;
  await topology.buildConstructIndex();

  assert.equal(topology.constructIndexMeta?.reused, true);
  assert.equal(topology.pythonAnalysis, null);
  assert.ok(topology.palUniqueIndex?.name);
  assert.ok(topology.palValuesIndex?.name);
  const csv = await fs.readFile(csvPath, 'utf8');
  assert.match(csv, /,function,build,/);
});


test('Python AST analyzer resolves function-valued dictionary dispatch calls', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-dict-dispatch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'main.py'), `
def add(left, right):
    return left + right

def stack(left, right):
    return (left, right)

_ops = {
    "+": add,
    "&": stack,
}

def dynamic(op, left, right):
    return _ops[op](left, right)

def literal(left, right):
    return _ops["&"](left, right)
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['main.py'] });
  assert.equal(result.version, 12);

  const byName = new Map((result.symbols || []).map((symbol) => [symbol.name, symbol]));
  const dynamic = byName.get('dynamic');
  const literal = byName.get('literal');
  const add = byName.get('add');
  const stack = byName.get('stack');

  const dynamicDispatch = (dynamic?.references || []).filter((ref) =>
    ref.resolution === 'python_ast_dict_dispatch' &&
    ref.dispatchTable === '_ops'
  );
  assert.deepEqual(
    new Set(dynamicDispatch.map((ref) => ref.targetSymbolId)),
    new Set([add?.id, stack?.id])
  );
  assert.ok(dynamicDispatch.every((ref) => ref.dispatchSelector === 'op'));

  const literalDispatch = (literal?.references || []).filter((ref) =>
    ref.resolution === 'python_ast_dict_dispatch' &&
    ref.dispatchTable === '_ops'
  );
  assert.equal(literalDispatch.length, 1);
  assert.equal(literalDispatch[0]?.targetSymbolId, stack?.id);
  assert.equal(literalDispatch[0]?.dispatchKey, '&');
});
