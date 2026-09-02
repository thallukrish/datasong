import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInformationNeedPrompt, normalizeInformationNeedResponse } from '../src/semantic/informationNeedPlanner.js';
import { normalizeLocalEntityResponse } from '../src/semantic/localEntityResolver.js';

const candidateQuestions = [
  {
    questionId: 'field:assessment-year',
    answerKind: 'value',
    fieldId: 'assessment-year',
    label: 'Select Assessment year',
    inputType: 'select',
    options: [{ value: '2026-27', label: '2026-27' }, { value: '2025-26', label: '2025-26' }]
  },
  {
    questionId: 'group:filing-reason',
    answerKind: 'choice',
    groupId: 'filing-reason',
    label: 'Why are you filing?',
    cardinality: 'exactly_one',
    options: [{ fieldId: 'reason-income', label: 'Income above exemption limit' }, { fieldId: 'reason-proviso', label: 'Seventh Proviso conditions' }]
  }
];

const navigationCandidates = [
  { id: 'continue', label: 'Continue', kind: 'action', enabled: true, safety: 'policy-required' },
  { id: 'dashboard', label: 'Dashboard', kind: 'link', enabled: true, safety: 'policy-required' }
];

test('information-need planner may navigate without asking merely because empty fields exist', () => {
  const prompt = buildInformationNeedPrompt({
    userGoal: 'I want to file ITR-3',
    semanticContext: { semanticName: 'Return Filing Setup', description: 'Selects filing context.' },
    workflowContext: { semanticPath: ['Return Filing Setup'] },
    candidateQuestions,
    navigationCandidates
  });
  assert.match(prompt, /I want to file ITR-3/);
  assert.match(prompt, /Select Assessment year/);
  assert.match(prompt, /do not ask/i);

  const plan = normalizeInformationNeedResponse({
    decision: 'navigate',
    questionIds: ['field:assessment-year'],
    confidence: 0.91,
    reason: 'The current defaults are sufficient to proceed.'
  }, candidateQuestions);
  assert.equal(plan.decision, 'navigate');
  assert.deepEqual(plan.questionIds, []);
});

test('information-need planner selects only user-specific questions required for progress', () => {
  const plan = normalizeInformationNeedResponse({
    decision: 'ask_user',
    questionIds: ['group:filing-reason', 'made-up'],
    confidence: 0.96,
    reason: 'Filing reason is taxpayer-specific and changes the downstream branch.'
  }, candidateQuestions);
  assert.equal(plan.decision, 'ask_user');
  assert.deepEqual(plan.questionIds, ['group:filing-reason']);
});

test('local semantic resolver can describe multiple semantic entities in one rendered context', () => {
  const semantic = normalizeLocalEntityResponse({
    semanticName: 'Return Filing Setup',
    description: 'Configures the return filing context.',
    subEntities: [
      {
        semanticName: 'Assessment Year',
        description: 'The tax assessment period for the return.',
        structuralFieldIds: ['assessment-year'],
        relationshipToParent: 'filing context'
      },
      {
        semanticName: 'Filing Mode',
        description: 'Whether the return is prepared online or offline.',
        structuralFieldIds: ['filing-mode-online', 'filing-mode-offline'],
        relationshipToParent: 'filing context'
      }
    ],
    fields: [], relationships: [], actions: [], localCompletion: 'Assessment year and mode are sufficient.', confidence: 0.94
  });
  assert.equal(semantic.subEntities.length, 2);
  assert.equal(semantic.subEntities[0].semanticName, 'Assessment Year');
  assert.deepEqual(semantic.subEntities[0].structuralFieldIds, ['assessment-year']);
});
