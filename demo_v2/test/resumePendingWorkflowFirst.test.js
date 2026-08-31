import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const resume = fs.readFileSync(path.join(here, '../server/explorer/resumeLearning.js'), 'utf8');

test('persisted learning dispatches the scheduler-selected unfinished whole-flow as the prepared root observation', () => {
  assert.match(resume, /async run\(repoUrl\)/);
  assert.match(resume, /this\._wholeFlowNextArcId/);
  assert.match(resume, /resumePass2Arc\?\.\(pendingId\)/);
  assert.match(resume, /return \{ \.\.\.prep, root: observation \}/);
  assert.match(resume, /return await super\.run\(repoUrl\)/);
});

test('fresh learning still falls through to the repository root when no unfinished workflow is scheduled', () => {
  assert.match(resume, /if \(!pendingId\) return prep/);
  assert.match(resume, /if \(!observation\) return prep/);
});
