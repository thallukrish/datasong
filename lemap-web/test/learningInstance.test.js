import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstanceGraph, upsertInstanceValue } from '../src/graph/instanceGraph.js';

test('learning instances persist mode and source while preserving backward-compatible runtime writes', () => {
  const instances = createInstanceGraph();
  const learned = upsertInstanceValue(instances, 'field:a', 'synthetic', { mode: 'learning', source: 'model' });
  assert.equal(learned.value, 'synthetic');
  assert.equal(learned.mode, 'learning');
  assert.equal(learned.source, 'model');

  upsertInstanceValue(instances, 'field:a', 'manual', { mode: 'learning', source: 'user' });
  assert.equal(instances[0].value, 'manual');
  assert.equal(instances[0].mode, 'learning');
  assert.equal(instances[0].source, 'user');

  const runtime = upsertInstanceValue(instances, 'field:b', 'real');
  assert.equal(runtime.mode, undefined);
  assert.equal(runtime.source, undefined);
});
