import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function jsFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await jsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('demo_v3 runtime is self-contained and never imports demo_v2', async () => {
  const files = await jsFiles(root);
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    assert.doesNotMatch(source, /(?:from\s+['"][^'"]*demo_v2|import\s*\([^)]*demo_v2|require\s*\([^)]*demo_v2)/, path.relative(root, file));
  }
});

test('vendored v3 topology entry point imports without demo_v2', async () => {
  const mod = await import('../server/topology/progressiveRepositoryTopologyV7.js');
  assert.equal(typeof mod.ProgressiveRepositoryTopologyV7, 'function');
});
