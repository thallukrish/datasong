import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInformationNeedPrompt, normalizeInformationNeedResponse } from '../src/semantic/informationNeedPlanner.js';
import { normalizeLocalEntityResponse } from '../src/semantic/localEntityResolver.js';
import { classifyInput } from '../src/preprocess/inputClassifier.js';
import { createSemanticMemory, recordEntityKnowledge } from '../src/agent/memory.js';

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

test('planner context excludes resolved interaction semantics when there are no candidate questions', () => {
  const prompt = buildInformationNeedPrompt({
    userGoal: 'I want to file ITR-3',
    semanticContext: {
      semanticName: 'File Income Tax Return – ITR-3',
      description: 'Assessment year and filing mode have been established.',
      interactions: [
        { semanticKey: 'assessment-year', semanticName: 'Assessment Year', question: 'Which assessment year?', explanation: 'Required filing period.' },
        { semanticKey: 'filing-mode', semanticName: 'Filing Mode', question: 'Online or offline?', explanation: 'Filing channel.' }
      ]
    },
    workflowContext: {
      semanticPath: ['File Income Tax Return – ITR-3'],
      userAnswers: [
        { question: 'Which assessment year?', valueProvided: true },
        { question: 'Online or offline?', selectedLabels: ['Online (Recommended)'] }
      ]
    },
    candidateQuestions: [],
    navigationCandidates
  });
  assert.doesNotMatch(prompt, /"semanticKey":"assessment-year"/);
  assert.doesNotMatch(prompt, /"semanticKey":"filing-mode"/);
  assert.match(prompt, /"candidateQuestions":\[\]/);
  assert.match(prompt, /"label":"Continue"/);
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

test('Angular Material mat-select is structurally classified as a select, not autocomplete', () => {
  assert.equal(classifyInput({ tag: 'mat-select', role: 'combobox' }), 'select');
});

test('semantic memory retains discovered value domains for reuse', () => {
  const memory = createSemanticMemory('I want to file ITR-3');
  recordEntityKnowledge(memory, {
    structuralEntity: { id: 'entity:setup', label: 'Return Filing Setup' },
    structuralGraph: {
      fields: [{ id: 'assessment-year', label: 'Select Assessment year', type: 'select', valueDomain: ['2026-27', '2025-26'] }],
      groups: [], actions: []
    },
    semanticEntity: { semanticName: 'Return Filing Setup' }
  });
  assert.deepEqual(memory.entities['entity:setup'].structure.fields[0].valueDomain, ['2026-27', '2025-26']);
});
