import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyInteractionItems, buildConfirmationSummary, interactionFields, confirmationDecision } from '../src/agent/userInteraction.js';
import { createInstanceMemory, recordInstanceFact } from '../src/agent/instanceMemory.js';

const graph = {
  fields: [
    { id: 'field:region', label: 'Region', type: 'select', valueDomain: ['West', 'East'] },
    { id: 'field:mode-standard', label: 'Standard', type: 'radio', parentGroupId: 'group:mode' },
    { id: 'field:mode-express', label: 'Express', type: 'radio', parentGroupId: 'group:mode' },
    { id: 'field:note', label: 'Note', type: 'text' }
  ],
  groups: [{ id: 'group:mode', label: 'Delivery mode', groupType: 'radio', memberFieldIds: ['field:mode-standard', 'field:mode-express'] }]
};

const semanticEntity = {
  interactions: [
    { semanticKey: 'region', structuralFieldIds: ['field:region'], explanation: 'The active region.', question: 'Which region?', valueScope: 'actor', reusePolicy: 'same_scope', requiredForGoal: true, goalRelevance: 0.95, priority: 1 },
    { semanticKey: 'delivery-mode', structuralFieldIds: ['field:mode-standard', 'field:mode-express'], explanation: 'How the item will be delivered.', question: 'Standard or express?', valueScope: 'workflow', reusePolicy: 'same_scope', requiredForGoal: true, goalRelevance: 0.8, priority: 2, dependsOnSemanticKeys: ['region'] },
    { semanticKey: 'note', structuralFieldIds: ['field:note'], explanation: 'Optional note.', question: 'Add a note?', valueScope: 'workflow_instance', reusePolicy: 'never', requiredForGoal: false, goalRelevance: 0.1, priority: 99 }
  ],
  completionInteraction: { confirmationIntro: 'Before I continue, these details are already set:', confirmationQuestion: 'Are these correct, or tell me what to change?' }
};

test('interaction layer distinguishes prefilled remembered and optional without changing semantic graph', () => {
  const state = { fields: {
    'field:region': { enabled: true, visible: true, value: 'West' },
    'field:mode-standard': { enabled: true, visible: true, checked: false, value: null },
    'field:mode-express': { enabled: true, visible: true, checked: false, value: null },
    'field:note': { enabled: true, visible: true, value: '' }
  }};
  const instance = createInstanceMemory();
  recordInstanceFact(instance, { semanticKey: 'delivery-mode', value: 'Express', optionLabel: 'Express', source: 'user', scope: 'workflow', workflowKey: 'create-shipment', scopeKey: 'create-shipment' });

  const items = classifyInteractionItems({ graph, state, semanticEntity, instanceMemory: instance, workflowKey: 'create-shipment', scopeKeys: { actor: 'actor-1', workflow: 'create-shipment', workflow_instance: 'run-1' } });
  assert.equal(items.find((item) => item.semanticKey === 'region').status, 'prefilled');
  assert.equal(items.find((item) => item.semanticKey === 'delivery-mode').status, 'remembered');
  assert.equal(items.find((item) => item.semanticKey === 'note').status, 'optional');
});

test('semantic dependencies block later user questions until prerequisite has state', () => {
  const state = { fields: {
    'field:region': { enabled: true, visible: true, value: '' },
    'field:mode-standard': { enabled: true, visible: true, checked: false, value: null },
    'field:mode-express': { enabled: true, visible: true, checked: false, value: null },
    'field:note': { enabled: true, visible: true, value: '' }
  }};
  const items = classifyInteractionItems({ graph, state, semanticEntity, instanceMemory: createInstanceMemory(), workflowKey: 'create-shipment', scopeKeys: { actor: 'actor-1', workflow: 'create-shipment', workflow_instance: 'run-1' } });
  assert.equal(items.find((item) => item.semanticKey === 'region').status, 'missing');
  assert.equal(items.find((item) => item.semanticKey === 'delivery-mode').status, 'blocked');
  assert.equal(items[0].semanticKey, 'region');
});

test('model priority and goal relevance determine interaction ordering, not structural field order', () => {
  const reordered = {
    interactions: [
      { semanticKey: 'delivery-mode', structuralFieldIds: ['field:mode-standard', 'field:mode-express'], question: 'Mode?', requiredForGoal: true, goalRelevance: 0.8, priority: 20 },
      { semanticKey: 'region', structuralFieldIds: ['field:region'], question: 'Region?', requiredForGoal: true, goalRelevance: 0.95, priority: 10 }
    ]
  };
  const state = { fields: {
    'field:region': { enabled: true, visible: true, value: '' },
    'field:mode-standard': { enabled: true, visible: true, checked: false, value: null },
    'field:mode-express': { enabled: true, visible: true, checked: false, value: null }
  }};
  const items = classifyInteractionItems({ graph, state, semanticEntity: reordered, instanceMemory: createInstanceMemory(), workflowKey: 'create-shipment', scopeKeys: { workflow: 'create-shipment', workflow_instance: 'run-1' } });
  assert.deepEqual(items.filter((item) => item.status === 'missing').map((item) => item.semanticKey), ['region', 'delivery-mode']);
});

test('remembered interaction is deferred while its controls are disabled', () => {
  const state = { fields: {
    'field:region': { enabled: true, visible: true, value: 'West' },
    'field:mode-standard': { enabled: false, visible: true, checked: false, value: null },
    'field:mode-express': { enabled: false, visible: true, checked: false, value: null },
    'field:note': { enabled: true, visible: true, value: '' }
  }};
  const instance = createInstanceMemory();
  recordInstanceFact(instance, { semanticKey: 'delivery-mode', value: 'Express', optionLabel: 'Express', source: 'user', scope: 'workflow', workflowKey: 'create-shipment', scopeKey: 'create-shipment' });

  const items = classifyInteractionItems({ graph, state, semanticEntity, instanceMemory: instance, workflowKey: 'create-shipment', scopeKeys: { actor: 'actor-1', workflow: 'create-shipment', workflow_instance: 'run-1' } });
  const mode = items.find((item) => item.semanticKey === 'delivery-mode');
  assert.equal(mode.status, 'blocked');
  assert.equal(mode.displayValue, 'Express');
  assert.equal(mode.rememberedFact?.optionLabel, 'Express');
});

test('interaction binding to one finite-choice member expands to the whole structural group', () => {
  const fields = interactionFields(graph, { structuralFieldIds: ['field:mode-standard'] });
  assert.deepEqual(fields.map((field) => field.id).sort(), ['field:mode-express', 'field:mode-standard']);
});

test('confirmation summary includes only prefilled or reused values', () => {
  const summary = buildConfirmationSummary({
    semanticEntity,
    items: [
      { semanticKey: 'region', status: 'prefilled', displayValue: 'West' },
      { semanticKey: 'delivery-mode', status: 'remembered', displayValue: 'Express' },
      { semanticKey: 'note', status: 'optional', displayValue: '' }
    ]
  });
  assert.equal(summary.items.length, 2);
  assert.match(summary.question, /correct/i);
});

test('single-item confirmation accepts yes, option number, or displayed value locally', () => {
  const summary = { items: [{ semanticKey: 'account-type', label: 'Account Type', value: 'Individual', source: 'prefilled' }] };
  assert.equal(confirmationDecision(summary, 'yes'), 'accept');
  assert.equal(confirmationDecision(summary, '1'), 'accept');
  assert.equal(confirmationDecision(summary, 'Individual'), 'accept');
  assert.equal(confirmationDecision(summary, 'individual'), 'accept');
});

test('single-item confirmation rejects explicit no instead of entering field-selection mode', () => {
  const summary = { items: [{ semanticKey: 'account-type', label: 'Account Type', value: 'Individual', source: 'prefilled' }] };
  assert.equal(confirmationDecision(summary, 'no'), 'reject');
  assert.equal(confirmationDecision(summary, 'change'), 'reject');
});
