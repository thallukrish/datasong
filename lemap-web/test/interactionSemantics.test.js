import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocalEntityResponse, buildLocalEntityPrompt, expandInteractionBindings } from '../src/semantic/localEntityResolver.js';

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

test('semantic prompt prefers finite-choice behavior classes over repetitive raw probes', () => {
  const behavior = {
    kind: 'behavior_classes',
    sourceFieldId: 'field:year',
    coverage: { domainSize: 21, probedCount: 10, exhaustive: false, samplingMethod: 'seeded_random' },
    classes: [{ id: 'behavior-class:01', samples: [{ label: '2026-27' }, { label: '2024-25' }], effect: { actionsEnabled: ['field:continue'] }, wildcard: false }]
  };
  const prompt = buildLocalEntityPrompt({
    entityGraph: { entity: { id: 'entity:1', label: 'Filing setup' }, fields: [], actions: [], groups: [] },
    observations: [
      { id: 'observation:local:001', fieldId: 'field:year', action: { kind: 'select_option', value: '2026-27', purpose: 'option-probe' }, delta: { actionsEnabled: ['field:continue'] } },
      { id: 'observation:local:002', fieldId: 'field:year', action: { kind: 'select_option', value: '2025-26', purpose: 'option-probe' }, delta: { actionsEnabled: ['field:continue'] } }
    ],
    learnedRelationships: [
      { kind: 'action_effect', sourceFieldId: 'field:year', actionId: 'probe:1' },
      behavior
    ]
  });
  assert.match(prompt, /behavior_classes/);
  assert.match(prompt, /seeded_random/);
  assert.equal(prompt.includes('observation:local:001'), false);
  assert.equal(prompt.includes('probe:1'), false);
});

test('semantic interaction bound to one radio member expands deterministically to the whole group', () => {
  const semantic = normalizeLocalEntityResponse({
    semanticName: 'Filing setup',
    interactions: [{
      semanticKey: 'itr-mode',
      structuralFieldIds: ['field:online'],
      question: 'Online or offline?',
      valueScope: 'workflow',
      reusePolicy: 'same_scope'
    }]
  });
  const expanded = expandInteractionBindings(semantic, {
    groups: [{ id: 'group:mode', groupType: 'radio', memberFieldIds: ['field:online', 'field:offline'] }]
  });
  assert.deepEqual(expanded.interactions[0].structuralFieldIds.sort(), ['field:offline', 'field:online']);
});
