import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzePythonRepository } from '../server/languages/python/adapter.js';

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

