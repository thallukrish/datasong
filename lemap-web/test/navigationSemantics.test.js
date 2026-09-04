import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigationPrompt } from '../src/semantic/navigationScout.js';

test('navigation scout receives semantic action roles learned with the local entity', () => {
  const prompt = buildNavigationPrompt({
    userGoal: 'Create a shipment',
    semanticEntity: {
      semanticName: 'Shipment setup',
      actions: [{ structuralFieldId: 'field:continue', semanticName: 'Continue shipment', description: 'Moves to the next step.', role: 'workflow_continuation' }]
    },
    workflowContext: {},
    candidates: [{ id: 'candidate:continue', fieldId: 'field:continue', label: 'Continue', kind: 'action', enabled: true }]
  });
  assert.match(prompt, /workflow_continuation/);
  assert.match(prompt, /Continue shipment/);
});
