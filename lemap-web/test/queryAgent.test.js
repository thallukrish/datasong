import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserQuestions, normalizeUserAnswerResponse, buildUserAnswerPrompt, interpretUserAnswer } from '../src/agent/userInput.js';
import { buildNavigationPrompt, normalizeNavigationResponse } from '../src/semantic/navigationScout.js';
import { createSemanticMemory, recordEntityKnowledge, recordSelectedTransition } from '../src/agent/memory.js';
import { chooseExecutableNavigation, fieldInteractionKind } from '../src/agent/browserActions.js';

const graph = {
  entity: { id: 'entity:filing', label: 'Filing status' },
  fields: [
    { id: 'field:n', label: 'Taxable income above exemption limit', type: 'radio', parentGroupId: 'group:reason' },
    { id: 'field:y', label: 'Seventh Proviso conditions', type: 'radio', parentGroupId: 'group:reason' },
    { id: 'field:c1', label: 'Deposits above threshold', type: 'checkbox', parentGroupId: 'group:conditions' },
    { id: 'field:c2', label: 'Foreign travel above threshold', type: 'checkbox', parentGroupId: 'group:conditions' },
    { id: 'field:date', label: 'Filing date', type: 'date', parentGroupId: '' }
  ],
  groups: [
    { id: 'group:reason', label: 'Why are you filing?', groupType: 'radio', memberFieldIds: ['field:n', 'field:y'] },
    { id: 'group:conditions', label: 'Which qualifying conditions apply?', groupType: 'checkbox', memberFieldIds: ['field:c1', 'field:c2'] }
  ]
};

const state = {
  fields: {
    'field:n': { enabled: true, visible: true, checked: true, value: 'N' },
    'field:y': { enabled: true, visible: true, checked: false, value: null },
    'field:c1': { enabled: false, visible: true, checked: false, value: false },
    'field:c2': { enabled: false, visible: true, checked: false, value: false },
    'field:date': { enabled: true, visible: true, value: '' }
  }
};

test('query agent asks actionable unresolved groups before empty standalone fields', () => {
  const questions = buildUserQuestions({ graph, state, answeredQuestionIds: new Set() });
  assert.equal(questions[0].groupId, 'group:reason');
  assert.equal(questions[0].cardinality, 'exactly_one');
  assert.deepEqual(questions[0].options.map((option) => option.fieldId), ['field:n', 'field:y']);
  assert.ok(questions.some((question) => question.questionId === 'field:field:date' && question.answerKind === 'value'));
});

test('browser executor treats Angular Material select as a combobox instead of a fillable text field', () => {
  assert.equal(fieldInteractionKind({ type: 'text', tag: 'mat-select', role: 'combobox' }), 'combobox');
  assert.equal(fieldInteractionKind({ type: 'select', tag: 'select', role: '' }), 'native_select');
  assert.equal(fieldInteractionKind({ type: 'text', tag: 'input', role: '' }), 'fillable');
});

test('intermediate Submit is allowed when it is a workflow continuation but final submission remains blocked', () => {
  const score = { candidateId: 'submit-step', role: 'workflow_continuation', goalRelevance: 1, continuity: 1, forwardProgress: 1 };
  const intermediate = chooseExecutableNavigation([score], [{ id: 'submit-step', label: 'Submit', kind: 'action', enabled: true, visible: true }]);
  assert.equal(intermediate?.candidate?.id, 'submit-step');

  const finalScore = { ...score, candidateId: 'final-submit' };
  const final = chooseExecutableNavigation([finalScore], [{ id: 'final-submit', label: 'Final Submit', kind: 'action', enabled: true, visible: true }]);
  assert.equal(final, null);
});

test('user answer model contract maps natural language to known structural options only', () => {
  const question = buildUserQuestions({ graph, state, answeredQuestionIds: new Set() })[0];
  const prompt = buildUserAnswerPrompt({ userGoal: 'I want to file ITR-3', semanticEntity: { semanticName: 'Filing reason' }, question, userAnswer: 'the second one, seventh proviso' });
  assert.match(prompt, /I want to file ITR-3/);
  assert.match(prompt, /field:y/);
  const result = normalizeUserAnswerResponse({ selectedFieldIds: ['field:y', 'field:made-up'], confidence: 0.96, reason: 'User chose the second option.' }, question);
  assert.deepEqual(result.selectedFieldIds, ['field:y']);
  assert.equal(result.confidence, 0.96);
});

test('standalone value answer is preserved for the discovered field', () => {
  const question = buildUserQuestions({ graph, state, answeredQuestionIds: new Set() }).find((item) => item.answerKind === 'value');
  const result = normalizeUserAnswerResponse({ value: '13/09/2025', confidence: 0.98, reason: 'User supplied the filing date.' }, question);
  assert.equal(result.value, '13/09/2025');
  assert.equal(result.confidence, 0.98);
});

test('private value answers never call the model', async () => {
  const question = {
    questionId: 'interaction:pan',
    answerKind: 'value',
    fieldId: 'field:pan',
    label: 'What is your PAN?',
    inputType: 'text',
    cardinality: 'single_value',
    options: []
  };
  let calls = 0;
  const client = { chat: { completions: { create: async () => { calls += 1; throw new Error('model must not be called'); } } } };
  const result = await interpretUserAnswer({ client, model: 'test-model', userGoal: 'File ITR-3', semanticEntity: { semanticName: 'Personal details' }, question, userAnswer: 'ABCDE1234F' });
  assert.equal(calls, 0);
  assert.equal(result.value, 'ABCDE1234F');
  assert.equal(result.confidence, 1);
  assert.equal(result.local, true);
});

test('select value answers resolve option numbers locally instead of storing the literal number', async () => {
  const question = {
    questionId: 'interaction:assessment-year',
    answerKind: 'value',
    fieldId: 'field:assessment-year',
    label: 'For which assessment year are you filing?',
    inputType: 'select',
    cardinality: 'single_value',
    options: [
      { value: 'Select', label: 'Select' },
      { value: '2026-27 (Current A.Y.)', label: '2026-27 (Current A.Y.)' },
      { value: '2025-26', label: '2025-26' }
    ]
  };
  let calls = 0;
  const client = { chat: { completions: { create: async () => { calls += 1; throw new Error('model must not be called'); } } } };
  const result = await interpretUserAnswer({ client, model: 'test-model', question, userAnswer: '2' });
  assert.equal(calls, 0);
  assert.equal(result.value, '2026-27 (Current A.Y.)');
  assert.equal(result.local, true);
  assert.match(result.reason, /option number/i);
});

test('unambiguous choice answers are interpreted locally before model fallback', async () => {
  const question = {
    questionId: 'interaction:mode',
    answerKind: 'choice',
    label: 'How would you like to file?',
    cardinality: 'exactly_one',
    options: [
      { fieldId: 'field:online', label: 'Online (Recommended)' },
      { fieldId: 'field:offline', label: 'Offline' }
    ]
  };
  let calls = 0;
  const client = { chat: { completions: { create: async () => { calls += 1; throw new Error('model must not be called'); } } } };
  const byNumber = await interpretUserAnswer({ client, model: 'test-model', question, userAnswer: '2' });
  assert.deepEqual(byNumber.selectedFieldIds, ['field:offline']);
  assert.equal(byNumber.local, true);
  const byLabel = await interpretUserAnswer({ client, model: 'test-model', question, userAnswer: 'Online (Recommended)' });
  assert.deepEqual(byLabel.selectedFieldIds, ['field:online']);
  assert.equal(calls, 0);
});

test('navigation scout ranks candidates against original user goal, not continuity alone', () => {
  const candidates = [
    { id: 'continue', label: 'Continue', kind: 'action', enabled: true, safety: 'policy-required' },
    { id: 'dashboard', label: 'Dashboard', kind: 'link', href: '/dashboard', enabled: true, safety: 'policy-required' }
  ];
  const prompt = buildNavigationPrompt({ userGoal: 'I want to file ITR-3', semanticEntity: { semanticName: 'Filing reason' }, workflowContext: { path: ['Filing reason'] }, candidates });
  assert.match(prompt, /I want to file ITR-3/);
  const scores = normalizeNavigationResponse({ scores: [
    { candidateId: 'continue', goalRelevance: 0.9, continuity: 0.99, forwardProgress: 0.95, role: 'workflow_continuation', reason: 'Advances filing.' },
    { candidateId: 'dashboard', goalRelevance: 0.01, continuity: 0.02, forwardProgress: 0.01, role: 'workflow_exit', reason: 'Leaves filing.' }
  ] }, candidates);
  assert.equal(scores[0].candidateId, 'continue');
  assert.equal(scores[0].goalRelevance, 0.9);
});

test('persistent memory records learned entity knowledge and only the selected traversal edge', () => {
  const memory = createSemanticMemory('I want to file ITR-3');
  recordEntityKnowledge(memory, {
    structuralEntity: { id: 'entity:filing', label: 'Filing status', presentation: { route: '/filing-status' } },
    structuralGraph: graph,
    semanticEntity: { semanticName: 'Filing reason', description: 'Determines filing basis' },
    learnedRelationships: [{ kind: 'mutually_exclusive' }]
  });
  recordSelectedTransition(memory, {
    sourceEntityId: 'entity:filing',
    targetEntityId: 'entity:personal',
    candidate: { id: 'continue', label: 'Continue', kind: 'action' },
    score: { role: 'workflow_continuation', goalRelevance: 0.9, continuity: 0.99, forwardProgress: 0.95 },
    alternatives: [{ id: 'dashboard', label: 'Dashboard' }]
  });
  assert.equal(Object.keys(memory.entities).length, 1);
  assert.equal(memory.workflow.edges.length, 1);
  assert.equal(memory.workflow.edges[0].candidateId, 'continue');
  assert.deepEqual(memory.workflow.edges[0].retainedCandidateIds, ['dashboard']);
});
