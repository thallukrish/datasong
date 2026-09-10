import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunTransaction, shouldPromoteRun } from '../src/graph/runTransaction.js';

test('run transaction deep-clones canonical entity and instance graphs', () => {
  const canonicalEntities = [{ id: 'page:1', semantic: {}, links: [] }];
  const canonicalInstances = [{ id: 'instance:1', value: 'A', links: [] }];
  const tx = createRunTransaction(canonicalEntities, canonicalInstances);
  tx.entityGraph[0].semantic.changed = true;
  tx.instanceGraph[0].value = 'B';
  tx.entityGraph.push({ id: 'page:2', semantic: {}, links: [] });

  assert.deepEqual(canonicalEntities, [{ id: 'page:1', semantic: {}, links: [] }]);
  assert.deepEqual(canonicalInstances, [{ id: 'instance:1', value: 'A', links: [] }]);
  assert.equal(tx.entityGraph.length, 2);
  assert.equal(tx.instanceGraph[0].value, 'B');
});

test('useful partial workflow progress persists while failed/interrupted runs do not', () => {
  assert.equal(shouldPromoteRun('workflow_complete'), true);
  assert.equal(shouldPromoteRun('consequential_action'), true);
  assert.equal(shouldPromoteRun('no_executable_entity'), true);
  assert.equal(shouldPromoteRun('continuation_no_structural_change'), true);
  assert.equal(shouldPromoteRun('max_steps'), true);
  assert.equal(shouldPromoteRun('error'), false);
  assert.equal(shouldPromoteRun('interrupted'), false);
  assert.equal(shouldPromoteRun(''), false);
});
