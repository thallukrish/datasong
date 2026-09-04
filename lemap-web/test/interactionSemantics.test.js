import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocalEntityResponse, buildLocalEntityPrompt, expandInteractionBindings } from '../src/semantic/localEntityResolver.js';

test('semantic resolution persists reusable interaction semantics without user values', () => {
  const normalized = normalizeLocalEntityResponse({
    semanticName: 'Shipment setup',
    interactions: [{
      semanticKey: 'delivery-region',
      structuralFieldIds: ['field:region'],
      explanation: 'The region used for this shipment workflow.',
      question: 'Which delivery region should be used?',
      examples: ['West'],
      valueScope: 'workflow',
      reusePolicy: 'same_scope',
      confirmationQuestion: 'Is this delivery region correct?'
    }],
    completionInteraction: {
      confirmationIntro: 'Before I continue, these details are already set:',
      confirmationQuestion: 'Are these correct, or tell me what to change?'
    },
    confidence: 0.9
  });

  assert.equal(normalized.interactions[0].semanticKey, 'delivery-region');
  assert.equal(normalized.interactions[0].valueScope, 'workflow');
  assert.match(normalized.interactions[0].question, /delivery region/i);
  assert.match(normalized.completionInteraction.confirmationQuestion, /correct/i);
});

test('unknown domain-specific value scopes fall back to workflow_instance', () => {
  const normalized = normalizeLocalEntityResponse({
    semanticName: 'Setup',
    interactions: [{
      semanticKey: 'custom-field',
      structuralFieldIds: ['field:custom'],
      question: 'Which value?',
      valueScope: 'domain_specific_scope',
      reusePolicy: 'same_scope'
    }]
  });
  assert.equal(normalized.interactions[0].valueScope, 'workflow_instance');
});

test('semantic prompt receives only compact workflow arc context', () => {
  const prompt = buildLocalEntityPrompt({
    entityGraph: { entity: { id: 'entity:1', label: 'Shipment setup' }, fields: [], actions: [], groups: [] },
    workflowContext: {
      goal: 'Create a shipment',
      previousSemanticEntity: 'Shipment setup',
      recentSemanticPath: ['Orders', 'Shipment setup'],
      recentSelections: ['Region selected', 'Express selected'],
      ignoredLargeHistory: 'x'.repeat(5000)
    }
  });
  assert.match(prompt, /Create a shipment/);
  assert.match(prompt, /Shipment setup/);
  assert.match(prompt, /application\|actor\|workflow\|workflow_instance/);
  assert.equal(prompt.includes('x'.repeat(5000)), false);
});

test('semantic prompt prefers finite-choice behavior classes over repetitive raw probes', () => {
  const behavior = {
    kind: 'behavior_classes',
    sourceFieldId: 'field:region',
    coverage: { domainSize: 21, probedCount: 10, exhaustive: false, samplingMethod: 'seeded_random' },
    classes: [{ id: 'behavior-class:01', samples: [{ label: 'West' }, { label: 'East' }], effect: { actionsEnabled: ['field:continue'] }, wildcard: false }]
  };
  const prompt = buildLocalEntityPrompt({
    entityGraph: { entity: { id: 'entity:1', label: 'Shipment setup' }, fields: [], actions: [], groups: [] },
    observations: [
      { id: 'observation:local:001', fieldId: 'field:region', action: { kind: 'select_option', value: 'West', purpose: 'option-probe' }, delta: { actionsEnabled: ['field:continue'] } },
      { id: 'observation:local:002', fieldId: 'field:region', action: { kind: 'select_option', value: 'East', purpose: 'option-probe' }, delta: { actionsEnabled: ['field:continue'] } }
    ],
    learnedRelationships: [
      { kind: 'action_effect', sourceFieldId: 'field:region', actionId: 'probe:1' },
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
    semanticName: 'Shipment setup',
    interactions: [{
      semanticKey: 'delivery-mode',
      structuralFieldIds: ['field:standard'],
      question: 'Standard or express?',
      valueScope: 'workflow',
      reusePolicy: 'same_scope'
    }]
  });
  const expanded = expandInteractionBindings(semantic, {
    groups: [{ id: 'group:mode', groupType: 'radio', memberFieldIds: ['field:standard', 'field:express'] }]
  });
  assert.deepEqual(expanded.interactions[0].structuralFieldIds.sort(), ['field:express', 'field:standard']);
});
