import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstanceMemory, recordInstanceFact, findApplicableFact } from '../src/agent/instanceMemory.js';

test('instance memory stores user facts separately with scope metadata', () => {
  const memory = createInstanceMemory();
  recordInstanceFact(memory, {
    semanticKey: 'filing-mode',
    value: 'Online',
    source: 'user',
    scope: 'workflow',
    workflowKey: 'itr-3',
    scopeKey: 'itr-3'
  });

  assert.equal(memory.facts.length, 1);
  assert.equal(memory.facts[0].semanticKey, 'filing-mode');
  assert.equal(memory.facts[0].value, 'Online');
  assert.equal(memory.facts[0].source, 'user');
  assert.equal(memory.facts[0].scope, 'workflow');
});

test('instance fact reuse requires compatible scope', () => {
  const memory = createInstanceMemory();
  recordInstanceFact(memory, {
    semanticKey: 'assessment-year',
    value: '2026-27',
    source: 'user',
    scope: 'assessment_year',
    workflowKey: 'itr-3',
    scopeKey: '2026-27'
  });

  assert.equal(findApplicableFact(memory, { semanticKey: 'assessment-year', workflowKey: 'itr-3', scope: 'assessment_year', scopeKey: '2026-27' })?.value, '2026-27');
  assert.equal(findApplicableFact(memory, { semanticKey: 'assessment-year', workflowKey: 'itr-3', scope: 'assessment_year', scopeKey: '2027-28' }), null);
});
