import test from 'node:test';
import assert from 'node:assert/strict';
import { createSemanticMemory, startQuerySession } from '../src/agent/memory.js';
import { recordInteractionWorkflowTransition } from '../src/agent/interactionTransition.js';

test('interaction-triggered entity change becomes a workflow branch edge without storing user value', () => {
  const memory = createSemanticMemory('configure account');
  const session = startQuerySession(memory, 'configure account');
  const edge = recordInteractionWorkflowTransition(memory, {
    session,
    sourceEntityId: 'entity:parent',
    targetEntityId: 'entity:modal',
    interaction: { semanticKey: 'account-type', semanticName: 'Account Type', goalRelevance: 0.9 },
    behavior: { classId: 'behavior:account-type:2', effect: { entityChanged: true, routeChanged: false } }
  });

  assert.equal(edge.sourceEntityId, 'entity:parent');
  assert.equal(edge.targetEntityId, 'entity:modal');
  assert.equal(edge.candidateId, 'interaction:account-type:behavior:account-type:2');
  assert.equal(edge.kind, 'interaction');
  assert.equal(edge.role, 'workflow_branch');
  assert.equal(JSON.stringify(edge).includes('Individual'), false);
  assert.equal(session.path.includes(edge.id), true);
});
