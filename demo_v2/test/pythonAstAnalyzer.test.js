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

test('Python AST analyzer resolves module and from imports without global same-name guessing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-import-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'util.py'), 'def parse(value):\n    return value\n');
  await fs.writeFile(path.join(root, 'other.py'), 'def parse(value):\n    return None\n');
  await fs.writeFile(path.join(root, 'main.py'), 'import util\n\ndef main():\n    return util.parse("x")\n');

  const result = await analyzePythonRepository({ repoDir: root, files: ['main.py', 'util.py', 'other.py'] });
  const symbols = result.symbols || [];
  const main = symbols.find((symbol) => symbol.name === 'main');
  const utilParse = symbols.find((symbol) => symbol.name === 'parse' && symbol.sourcePath === 'util.py');
  const otherParse = symbols.find((symbol) => symbol.name === 'parse' && symbol.sourcePath === 'other.py');

  assert.ok(main.references.some((ref) => ref.targetSymbolId === utilParse.id));
  assert.ok(!main.references.some((ref) => ref.targetSymbolId === otherParse.id));
});

test('Python AST analyzer preserves imported external calls with call-site context', async (t) => {
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
  assert.equal(ref?.external, true);
  assert.equal(ref?.importModule, 'pydantic.fields');
  assert.equal(ref?.importName, 'Field');
  assert.equal(ref?.qualifiedName, 'pydantic.fields.Field');
  assert.deepEqual(ref?.keywordArgs, ['default', 'initial']);
  assert.match(ref?.callText || '', /Field\(default=['"]x['"], initial=/);
});

test('Python AST analyzer preserves re-exported external symbols and class-body external calls', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-api-boundary-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'main.py'), `
from pydantic.fields import Field

__all__ = ["Field", "Settings"]

class Settings:
    name = Field(default="x", initial=lambda: "y")
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['main.py'] });
  const external = result.externalSymbols || [];
  const importedField = external.find((item) => item.kind === 'external-symbol' && item.localName === 'Field');
  const fieldCall = external.find((item) => item.kind === 'external-call' && item.qualifiedName === 'pydantic.fields.Field');

  assert.equal(importedField?.reExported, true);
  assert.equal(importedField?.importModule, 'pydantic.fields');
  assert.equal(importedField?.importName, 'Field');

  assert.equal(fieldCall?.scopeKind, 'class-body');
  assert.equal(fieldCall?.scopeName, 'Settings');
  assert.deepEqual(fieldCall?.keywordArgs, ['default', 'initial']);
  assert.match(fieldCall?.callText || '', /Field\(default=['"]x['"], initial=/);
});

test('Python AST analyzer resolves absolute imports and calls through re-exported external symbols', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-reexport-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.mkdir(path.join(root, 'pkg'));
  await fs.mkdir(path.join(root, 'tests'));
  await fs.writeFile(path.join(root, 'pkg', '__init__.py'), `
from pydantic.fields import Field
__all__ = ["Field"]
`);
  await fs.writeFile(path.join(root, 'tests', 'test_fields.py'), `
from pkg import Field

class Settings:
    value = Field(default="x", initial=lambda: "y")
`);

  const result = await analyzePythonRepository({
    repoDir: root,
    files: ['pkg/__init__.py', 'tests/test_fields.py']
  });

  const call = (result.externalSymbols || []).find((item) =>
    item.kind === 'external-call' &&
    item.sourcePath === 'tests/test_fields.py' &&
    item.callText?.includes('initial=')
  );

  assert.equal(call?.qualifiedName, 'pydantic.fields.Field');
  assert.equal(call?.viaModule, 'pkg');
  assert.ok(call?.targetExternalId);
  assert.deepEqual(call?.keywordArgs, ['default', 'initial']);
});



test('Python AST analyzer emits searchable construct metadata for calls and conditions', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-construct-index-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'main.py'), `
from pydantic.fields import Field

def build():
    value = Field(default="x", initial=lambda: "y")
    if value is not None:
        return value
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['main.py'] });
  const call = (result.constructs || []).find((item) =>
    item.constructType === 'call' &&
    item.name === 'Field'
  );
  const condition = (result.constructs || []).find((item) => item.constructType === 'condition');

  assert.equal(result.version, 5);
  assert.equal(call?.parentFunction, 'build');
  assert.deepEqual(call?.keywordArgs, ['default', 'initial']);
  assert.match(call?.snippet || '', /Field\(default=['"]x['"], initial=/);
  assert.match(call?.canonicalSnippet || '', /Field\(default=['"]x['"], initial=/);
  assert.match(condition?.snippet || '', /if value is not None/);
});


test('CodeTopology reuses complete construct index snapshots by commit', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-construct-cache-'));
  const repoDir = path.join(root, 'repo');
  const cacheRoot = path.join(root, 'cache');
  await fs.mkdir(repoDir, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(repoDir, 'main.py'), 'def build():\n    return Field(initial=True)\n');

  const topology = new CodeTopology({ cacheRoot });
  topology.repoDir = repoDir;
  topology.repoUrl = 'https://example.invalid/demo.git';
  topology.files = ['main.py'];
  topology.commit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  await topology.buildConstructIndex();
  assert.equal(topology.constructIndexMeta?.reused, false);
  assert.ok(topology.constructIndex.some((item) => item.constructType === 'call' && item.name === 'Field'));
  const firstCount = topology.constructIndex.length;

  await fs.writeFile(path.join(repoDir, 'main.py'), 'def build():\n    return Other()\n');
  await topology.buildConstructIndex();

  assert.equal(topology.constructIndexMeta?.reused, true);
  assert.equal(topology.constructIndex.length, firstCount);
  assert.ok(topology.constructIndex.some((item) => item.constructType === 'call' && item.name === 'Field'));

  topology.commit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  await topology.buildConstructIndex();

  assert.equal(topology.constructIndexMeta?.reused, false);
  assert.ok(topology.constructIndex.some((item) => item.constructType === 'call' && item.name === 'Other'));
});


test('Python AST canonical snippet normalizes spacing while preserving original source snippet', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-spacing-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'main.py'), `
from pydantic import Field

def build():
    return Field ( initial = "x" )
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['main.py'] });
  const call = (result.constructs || []).find((item) => item.constructType === 'call' && item.name === 'Field');

  assert.equal(call?.name, 'Field');
  assert.deepEqual(call?.keywordArgs, ['initial']);
  assert.match(call?.snippet || '', /Field \( initial = "x" \)/);
  assert.equal(call?.canonicalSnippet, "Field(initial='x')");
});


test('Python AST emits low-cardinality LeMap loop and call facets', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-facets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'main.py'), `
from pydantic import Field

def build(arr):
    for i in range(0, len(arr)):
        Field(initial="x")
    for item in arr:
        print(item)
    while arr:
        break
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['main.py'] });
  const loops = (result.constructs || []).filter((item) => item.constructType === 'loop');
  const counted = loops.find((item) => item.loopKind === 'counted');
  const collection = loops.find((item) => item.loopKind === 'collection');
  const conditional = loops.find((item) => item.loopKind === 'conditional');
  const fieldCall = (result.constructs || []).find((item) => item.constructType === 'call' && item.name === 'Field');

  assert.equal(counted?.startKind, 'zero');
  assert.equal(counted?.endKind, 'collection_length');
  assert.equal(counted?.incrementKind, 'one');
  assert.ok(collection);
  assert.ok(conditional);
  assert.equal(fieldCall?.callKind, 'function');
  assert.equal(fieldCall?.argumentStyle, 'keyword');
  assert.equal(fieldCall?.positionalCountBand, '0');
});


test('CodeTopology force rebuild ignores an existing complete same-commit construct snapshot', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-construct-force-rebuild-'));
  const repoDir = path.join(root, 'repo');
  const cacheRoot = path.join(root, 'cache');
  await fs.mkdir(repoDir, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const topology = new CodeTopology({ cacheRoot });
  topology.repoDir = repoDir;
  topology.repoUrl = 'https://example.invalid/force-demo.git';
  topology.files = ['main.py'];
  topology.commit = 'cccccccccccccccccccccccccccccccccccccccc';

  await fs.writeFile(path.join(repoDir, 'main.py'), 'def build():\n    return Field(initial=True)\n');
  await topology.buildConstructIndex();
  assert.equal(topology.constructIndexMeta?.reused, false);
  assert.ok(topology.constructIndex.some((item) => item.constructType === 'call' && item.name === 'Field'));

  await fs.writeFile(path.join(repoDir, 'main.py'), 'def build():\n    return Other()\n');
  topology.forceConstructIndexRebuild = true;
  await topology.buildConstructIndex();

  assert.equal(topology.constructIndexMeta?.reused, false);
  assert.ok(topology.constructIndex.some((item) => item.constructType === 'call' && item.name === 'Other'));
  assert.ok(!topology.constructIndex.some((item) => item.constructType === 'call' && item.name === 'Field'));

  topology.forceConstructIndexRebuild = false;
  await fs.writeFile(path.join(repoDir, 'main.py'), 'def build():\n    return Third()\n');
  await topology.buildConstructIndex();

  assert.equal(topology.constructIndexMeta?.reused, true);
  assert.ok(topology.constructIndex.some((item) => item.constructType === 'call' && item.name === 'Other'));
});

test('Python regions only model control flow and retain assignment-wrapped self-call references', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-python-regions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'worker.py'), `
class Worker:
    def helper(self, value):
        return value

    def run(self, value):
        if value:
            try:
                result = self.helper(value)
            except ValueError:
                return None
        return result
`);

  const result = await analyzePythonRepository({ repoDir: root, files: ['worker.py'] });
  const symbols = result.symbols || [];
  const run = symbols.find((symbol) => symbol.name === 'Worker.run');
  const helper = symbols.find((symbol) => symbol.name === 'Worker.helper');

  assert.ok(run);
  assert.ok(helper);
  assert.ok(run.references.some((ref) => ref.targetSymbolId === helper.id));

  const regionKinds = (run.regions || []).map((region) => region.kind);
  assert.ok(regionKinds.includes('if'));
  assert.ok(regionKinds.includes('try'));
  assert.ok(!regionKinds.includes('assign'));
  assert.ok(!regionKinds.includes('return'));

  const tryRegion = (run.regions || []).find((region) => region.kind === 'try');
  assert.ok(tryRegion?.references?.some((ref) => ref.targetSymbolId === helper.id));
});

test('CodeTopology incrementally reuses unchanged Python files across commits', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-construct-incremental-'));
  const repoDir = path.join(root, 'repo');
  const cacheRoot = path.join(root, 'cache');
  await fs.mkdir(repoDir, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(repoDir, 'stable.py'), 'def stable():\n    return StableThing()\n');
  await fs.writeFile(path.join(repoDir, 'changed.py'), 'def changed():\n    return BeforeThing()\n');

  const topology = new CodeTopology({ cacheRoot });
  topology.repoDir = repoDir;
  topology.repoUrl = 'https://example.invalid/incremental-demo.git';
  topology.files = ['stable.py', 'changed.py'];
  topology.commit = '1111111111111111111111111111111111111111';

  await topology.buildConstructIndex();
  assert.equal(topology.constructIndexMeta?.incremental, false);
  assert.ok(topology.constructIndex.some((item) => item.sourcePath === 'stable.py' && item.name === 'StableThing'));
  assert.ok(topology.constructIndex.some((item) => item.sourcePath === 'changed.py' && item.name === 'BeforeThing'));

  await fs.writeFile(path.join(repoDir, 'changed.py'), 'def changed():\n    return AfterThing()\n');
  topology.commit = '2222222222222222222222222222222222222222';
  await topology.buildConstructIndex();

  assert.equal(topology.constructIndexMeta?.incremental, true);
  assert.equal(topology.constructIndexMeta?.incrementalFrom, '1111111111111111111111111111111111111111');
  assert.deepEqual(topology.constructIndexMeta?.affectedFiles, ['changed.py']);
  assert.ok(topology.constructIndex.some((item) => item.sourcePath === 'stable.py' && item.name === 'StableThing'));
  assert.ok(!topology.constructIndex.some((item) => item.sourcePath === 'changed.py' && item.name === 'BeforeThing'));
  assert.ok(topology.constructIndex.some((item) => item.sourcePath === 'changed.py' && item.name === 'AfterThing'));
});
