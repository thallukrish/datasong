import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../server/explorer/mapPersistence.js'), 'utf8');

test('traceability enrichment reuses cached grouped call paths instead of regrouping the full call graph per arc', () => {
  assert.match(source, /groupedCallPaths\?\.\(\)/);
  assert.doesNotMatch(source, /topCallPaths\?\.\(500\)/);
});
