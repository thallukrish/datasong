import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstanceMemory, recordInstanceFact, findApplicableFact } from '../src/agent/instanceMemory.js';

test('instance memory stores facts with generic workflow scope metadata', () => {
  const memory = createInstanceMemory();
  recordInstanceFact(memory, {
    semanticKey: 'delivery-mode',
    value: 'Express',
    source: 'user',
    scope: 'workflow',
    workflowKey: 'create-shipment',
    scopeKey: 'create-shipment'
  });

  assert.equal(memory.facts.length, 1);
  assert.equal(memory.facts[0].semanticKey, 'delivery-mode');
  assert.equal(memory.facts[0].value, 'Express');
  assert.equal(memory.facts[0].source, 'user');
  assert.equal(memory.facts[0].scope, 'workflow');
});

test('instance fact reuse requires compatible generic scope', () => {
  const memory = createInstanceMemory();
  recordInstanceFact(memory, {
    semanticKey: 'workspace-language',
    value: 'English',
    source: 'user',
    scope: 'application',
    workflowKey: '',
    scopeKey: 'application'
  });

  assert.equal(findApplicableFact(memory, { semanticKey: 'workspace-language', scope: 'application', scopeKey: 'application' })?.value, 'English');
  assert.equal(findApplicableFact(memory, { semanticKey: 'workspace-language', scope: 'actor', scopeKey: 'actor-1' }), null);
});

test('instance memory accepts only application actor workflow and workflow_instance scopes', () => {
  const scopes = ['application', 'actor', 'workflow', 'workflow_instance'];
  for (const scope of scopes) {
    const memory = createInstanceMemory();
    recordInstanceFact(memory, {
      semanticKey: `field-${scope}`,
      value: 'x',
      scope,
      workflowKey: 'workflow-a',
      scopeKey: `${scope}-key`
    });
    assert.equal(memory.facts[0].scope, scope);
  }

  const memory = createInstanceMemory();
  recordInstanceFact(memory, { semanticKey: 'unknown-scope', value: 'x', scope: 'domain_specific_scope', scopeKey: 'x' });
  assert.equal(memory.facts[0].scope, 'workflow_instance');
});
