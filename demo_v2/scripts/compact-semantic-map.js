import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactPersistedMap } from '../server/explorer/compactMapFormat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const mapDir = path.join(root, 'data', 'semantic-maps');

if (!fs.existsSync(mapDir)) {
  console.log(`[lemap compact] no semantic map directory: ${mapDir}`);
  process.exit(0);
}

const files = fs.readdirSync(mapDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => path.join(mapDir, name));

if (!files.length) {
  console.log('[lemap compact] no persisted semantic maps found');
  process.exit(0);
}

for (const file of files) {
  const beforeBytes = fs.statSync(file).size;
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(saved.graph)) {
    console.log(`[lemap compact] skip ${path.basename(file)}: unsupported legacy format`);
    continue;
  }
  const compact = compactPersistedMap(saved);
  const backup = `${file}.precompact.bak`;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);

  const tmp = `${file}.${process.pid}.compact.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(compact), 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);

  const afterBytes = fs.statSync(file).size;
  const pct = beforeBytes ? Math.round((1 - afterBytes / beforeBytes) * 100) : 0;
  console.log(`[lemap compact] ${path.basename(file)}: ${beforeBytes} -> ${afterBytes} bytes (${pct}% smaller)`);
  console.log(`[lemap compact] backup: ${path.basename(backup)}`);
}
