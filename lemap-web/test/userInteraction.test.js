import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyInteractionItems, buildConfirmationSummary } from '../src/agent/userInteraction.js';
import { createInstanceMemory, recordInstanceFact } from '../src/agent/instanceMemory.js';

const graph = {
  fields: [
    { id: 'field:year', label: 'Assessment year', type: 'select', valueDomain: ['2026-27', '2025-26'] },
    { id: 'field:mode-online', label: 'Online', type: 'radio', parentGroupId: 'group:mode' },
    { id: 'field:mode-offline', label: 'Offline', type: 'radio', parentGroupId: 'group:mode' },
    { id: 'field:section', label: 'Section', type: 'select', valueDomain: ['139(1)', '139(4)'] }
  ],
  groups: [{ id: 'group:mode', label: 'Filing mode', groupType: 'radio', memberFieldIds: ['field:mode-online', 'field:mode-offline'] }]
};

const semanticEntity = {
  interactions: [
    { semanticKey: 'assessment-year', structuralFieldIds: ['field:year'], explanation: 'The year being assessed.', question: 'Which assessment year are you filing for?', valueScope: 'assessment_year', reusePolicy: 'same_scope', confirmationQuestion: 'Is this assessment year correct?' },
    { semanticKey: 'filing-mode', structuralFieldIds: ['field:mode-online', 'field:mode-offline'], explanation: 'How the return will be prepared.', question: 'Would you like to file online or offline?', valueScope: 'workflow', reusePolicy: 'same_scope', confirmationQuestion: 'Is this filing mode correct?' },
    { semanticKey: 'filing-section', structuralFieldIds: ['field:section'], explanation: 'The legal/timing basis for filing.', question: 'Which filing situation applies?', valueScope: 'filing_instance', reusePolicy: 'never', confirmationQuestion: 'Is this filing basis correct?' }
  ],
  completionInteraction: { confirmationIntro: 'Before I continue, these details are already set:', confirmationQuestion: 'Are these correct, or tell me what to change?' }
};

test('interaction layer distinguishes prefilled remembered and missing without changing semantic graph', () => {
  const state = { fields: {
    'field:year': { enabled: true, visible: true, value: '2026-27' },
    'field:mode-online': { enabled: true, visible: true, checked: false, value: null },
    'field:mode-offline': { enabled: true, visible: true, checked: false, value: null },
    'field:section': { enabled: true, visible: true, value: '' }
  }};
  const instance = createInstanceMemory();
  recordInstanceFact(instance, { semanticKey: 'filing-mode', value: 'Online', optionLabel: 'Online', source: 'user', scope: 'workflow', workflowKey: 'itr-3', scopeKey: 'itr-3' });

  const items = classifyInteractionItems({ graph, state, semanticEntity, instanceMemory: instance, workflowKey: 'itr-3', scopeKeys: { assessment_year: '2026-27', workflow: 'itr-3', filing_instance: 'run-1' } });
  assert.equal(items.find((item) => item.semanticKey === 'assessment-year').status, 'prefilled');
  assert.equal(items.find((item) => item.semanticKey === 'filing-mode').status, 'remembered');
  assert.equal(items.find((item) => item.semanticKey === 'filing-section').status, 'missing');
});

test('confirmation summary includes only prefilled or reused values', () => {
  const summary = buildConfirmationSummary({
    semanticEntity,
    items: [
      { semanticKey: 'assessment-year', status: 'prefilled', displayValue: '2026-27' },
      { semanticKey: 'filing-mode', status: 'remembered', displayValue: 'Online' },
      { semanticKey: 'filing-section', status: 'missing', displayValue: '' }
    ]
  });
  assert.equal(summary.items.length, 2);
  assert.match(summary.question, /correct/i);
});
