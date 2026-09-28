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
