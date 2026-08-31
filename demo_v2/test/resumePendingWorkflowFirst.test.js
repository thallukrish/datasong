import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = fs.readFileSync(path.join(here, '../server/explorer.js'), 'utf8');
const resume = fs.readFileSync(path.join(here, '../server/explorer/resumeLearning.js'), 'utf8');

test('exploration startup is overridable instead of always forcing repository root', () => {
  assert.match(base, /async initialObservation\(prep\)/);
  assert.match(base, /let observation = await this\.initialObservation\(prep\)/);
  assert.doesNotMatch(base, /let observation = prep\.root/);
});

test('persisted learning resumes the scheduler-selected unfinished whole-flow before root exploration', () => {
  assert.match(resume, /async initialObservation\(prep\)/);
  assert.match(resume, /this\._wholeFlowNextArcId/);
  assert.match(resume, /resumePass2Arc\(/);
  assert.match(resume, /return super\.initialObservation\(prep\)/);
});
