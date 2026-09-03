import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocalEntityResponse, buildLocalEntityPrompt } from '../src/semantic/localEntityResolver.js';

test('semantic resolution persists reusable interaction semantics without user values', () => {
  const normalized = normalizeLocalEntityResponse({
    semanticName: 'Filing setup',
    interactions: [{
      semanticKey: 'assessment-year',
      structuralFieldIds: ['field:year'],
      explanation: 'The year in which the prior financial year is assessed.',
      question: 'Which assessment year are you filing for?',
      examples: ['2026-27'],
      valueScope: 'assessment_year',
      reusePolicy: 'same_scope',
      confirmationQuestion: 'Is this assessment year correct?'
    }],
    completionInteraction: {
      confirmationIntro: 'Before I continue, these details are already set:',
      confirmationQuestion: 'Are these correct, or tell me what to change?'
    },
    confidence: 0.9
  });

  assert.equal(normalized.interactions[0].semanticKey, 'assessment-year');
  assert.equal(normalized.interactions[0].valueScope, 'assessment_year');
  assert.match(normalized.interactions[0].question, /assessment year/i);
  assert.match(normalized.completionInteraction.confirmationQuestion, /correct/i);
});

test('semantic prompt receives only compact workflow arc context', () => {
  const prompt = buildLocalEntityPrompt({
    entityGraph: { entity: { id: 'entity:1', label: 'Filing setup' }, fields: [], actions: [], groups: [] },
    workflowContext: {
      goal: 'File ITR-3',
      previousSemanticEntity: 'Return setup',
      recentSemanticPath: ['File return', 'Return setup'],
      recentSelections: ['Assessment Year selected', 'Online selected'],
      ignoredLargeHistory: 'x'.repeat(5000)
    }
  });
  assert.match(prompt, /File ITR-3/);
  assert.match(prompt, /Return setup/);
  assert.equal(prompt.includes('x'.repeat(5000)), false);
});

test('behavior classes replace repetitive raw finite-choice probe evidence in semantic prompt', () => {
  const prompt = buildLocalEntityPrompt({
    entityGraph: {
      entity: { id: 'entity:1', label: 'Filing setup' },
      fields: [{ id: 'field:year', label: 'Assessment Year', type: 'select', visible: true, disabled: false, valueDomain: ['2026-27', '2025-26'] }],
      actions: [], groups: []
    },
    observations: [
      { id: 'obs:1', fieldId: 'field:year', action: { purpose: 'option-probe', value: '2026-27' }, delta: { actionsEnabled: ['continue'] } },
      { id: 'obs:2', fieldId: 'field:year', action: { purpose: 'option-probe', value: '2025-26' }, delta: { actionsEnabled: ['continue'] } }
    ],
    learnedRelationships: [{
      kind: 'behavior_classes', sourceFieldId: 'field:year',
      coverage: { domainSize: 21, probedCount: 10, exhaustive: false, samplingMethod: 'seeded_random' },
      classes: [{ id: 'behavior-class:01', sampleCount: 10, wildcard: false, sampleValues: ['2026-27', '2025-26'], effect: { actionsEnabled: ['continue'] } }]
    }]
  });

  assert.match(prompt, /behavior_classes/);
  assert.match(prompt, /seeded_random/);
  assert.equal(prompt.includes('"id":"obs:1"'), false);
  assert.equal(prompt.includes('"id":"obs:2"'), false);
});
