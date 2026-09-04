import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserQuestions, normalizeUserAnswerResponse, buildUserAnswerPrompt, interpretUserAnswer } from '../src/agent/userInput.js';
import { buildNavigationPrompt, normalizeNavigationResponse } from '../src/semantic/navigationScout.js';
import { createSemanticMemory, recordEntityKnowledge, recordSelectedTransition } from '../src/agent/memory.js';
import { fieldInteractionKind, chooseExecutableNavigation } from '../src/agent/browserActions.js';
import { workflowKeyFromGoal } from '../src/agent/workflowIdentity.js';

const graph = {
  entity: { id: 'entity:setup', label: 'Setup' },
  fields: [
    { id: 'field:n', label: 'Standard', type: 'radio', parentGroupId: 'group:reason' },
    { id: 'field:y', label: 'Advanced', type: 'radio', parentGroupId: 'group:reason' },
    { id: 'field:c1', label: 'Enable option A', type: 'checkbox', parentGroupId: 'group:conditions' },
    { id: 'field:c2', label: 'Enable option B', type: 'checkbox', parentGroupId: 'group:conditions' },
    { id: 'field:date', label: 'Start date', type: 'date', parentGroupId: '' }
  ],
  groups: [
    { id: 'group:reason', label: 'Which setup?', groupType: 'radio', memberFieldIds: ['field:n', 'field:y'] },
    { id: 'group:conditions', label: 'Which options apply?', groupType: 'checkbox', memberFieldIds: ['field:c1', 'field:c2'] }
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

test('workflow identity is derived generically from the user goal', () => {
  assert.equal(workflowKeyFromGoal('Create a shipment'), 'create-a-shipment');
  assert.equal(workflowKeyFromGoal('Review   customer order #42'), 'review-customer-order-42');
  assert.equal(workflowKeyFromGoal(''), 'workflow');
});

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

test('user answer model contract maps natural language to known structural options only', () => {
  const question = buildUserQuestions({ graph, state, answeredQuestionIds: new Set() })[0];
  const prompt = buildUserAnswerPrompt({ userGoal: 'Configure an account', semanticEntity: { semanticName: 'Setup' }, question, userAnswer: 'the second one' });
  assert.match(prompt, /Configure an account/);
  assert.match(prompt, /field:y/);
  const result = normalizeUserAnswerResponse({ selectedFieldIds: ['field:y', 'field:made-up'], confidence: 0.96, reason: 'User chose the second option.' }, question);
  assert.deepEqual(result.selectedFieldIds, ['field:y']);
  assert.equal(result.confidence, 0.96);
});

test('standalone value answer is preserved for the discovered field', () => {
  const question = buildUserQuestions({ graph, state, answeredQuestionIds: new Set() }).find((item) => item.answerKind === 'value');
  const result = normalizeUserAnswerResponse({ value: '2026-09-04', confidence: 0.98, reason: 'User supplied the date.' }, question);
  assert.equal(result.value, '2026-09-04');
  assert.equal(result.confidence, 0.98);
});

test('private value answers never call the model', async () => {
  const question = {
    questionId: 'interaction:account-id', answerKind: 'value', fieldId: 'field:account-id',
    label: 'What is your account ID?', inputType: 'text', cardinality: 'single_value', options: []
  };
  let calls = 0;
  const client = { chat: { completions: { create: async () => { calls += 1; throw new Error('model must not be called'); } } } };
  const result = await interpretUserAnswer({ client, model: 'test-model', userGoal: 'Configure account', semanticEntity: { semanticName: 'Account' }, question, userAnswer: 'ABC123' });
  assert.equal(calls, 0);
  assert.equal(result.value, 'ABC123');
  assert.equal(result.confidence, 1);
  assert.equal(result.local, true);
});

test('select value answers resolve option numbers locally instead of storing the literal number', async () => {
  const question = {
    questionId: 'interaction:region', answerKind: 'value', fieldId: 'field:region', label: 'Which region?', inputType: 'select', cardinality: 'single_value',
    options: [{ value: 'Select', label: 'Select' }, { value: 'West', label: 'West' }, { value: 'East', label: 'East' }]
  };
  let calls = 0;
  const client = { chat: { completions: { create: async () => { calls += 1; throw new Error('model must not be called'); } } } };
  const result = await interpretUserAnswer({ client, model: 'test-model', question, userAnswer: '2' });
  assert.equal(calls, 0);
  assert.equal(result.value, 'West');
  assert.equal(result.local, true);
  assert.match(result.reason, /option number/i);
});

test('unambiguous choice answers are interpreted locally before model fallback', async () => {
  const question = {
    questionId: 'interaction:mode', answerKind: 'choice', label: 'How would you like to proceed?', cardinality: 'exactly_one',
    options: [{ fieldId: 'field:online', label: 'Online' }, { fieldId: 'field:offline', label: 'Offline' }]
  };
  let calls = 0;
  const client = { chat: { completions: { create: async () => { calls += 1; throw new Error('model must not be called'); } } } };
  const byNumber = await interpretUserAnswer({ client, model: 'test-model', question, userAnswer: '2' });
  assert.deepEqual(byNumber.selectedFieldIds, ['field:offline']);
  assert.equal(byNumber.local, true);
  const byLabel = await interpretUserAnswer({ client, model: 'test-model', question, userAnswer: 'Online' });
  assert.deepEqual(byLabel.selectedFieldIds, ['field:online']);
  assert.equal(calls, 0);
});

test('navigation scout ranks candidates against original user goal, not continuity alone', () => {
  const candidates = [
    { id: 'continue', label: 'Continue', kind: 'action', enabled: true },
    { id: 'dashboard', label: 'Dashboard', kind: 'link', href: '/dashboard', enabled: true }
  ];
  const prompt = buildNavigationPrompt({ userGoal: 'Create a shipment', semanticEntity: { semanticName: 'Shipment setup' }, workflowContext: { path: ['Shipment setup'] }, candidates });
  assert.match(prompt, /Create a shipment/);
  const scores = normalizeNavigationResponse({ scores: [
    { candidateId: 'continue', goalRelevance: 0.9, continuity: 0.99, forwardProgress: 0.95, role: 'workflow_continuation', consequence: 'reversible', reason: 'Advances setup.' },
    { candidateId: 'dashboard', goalRelevance: 0.01, continuity: 0.02, forwardProgress: 0.01, role: 'workflow_exit', consequence: 'reversible', reason: 'Leaves setup.' }
  ] }, candidates);
  assert.equal(scores[0].candidateId, 'continue');
  assert.equal(scores[0].goalRelevance, 0.9);
});

test('executor uses semantic consequence rather than domain-specific action labels', () => {
  const candidates = [
    { id: 'intermediate', label: 'Submit', kind: 'action', enabled: true, visible: true },
    { id: 'commit', label: 'Continue', kind: 'action', enabled: true, visible: true }
  ];
  const scores = [
    { candidateId: 'intermediate', role: 'workflow_continuation', consequence: 'reversible', goalRelevance: 1, continuity: 1, forwardProgress: 1 },
    { candidateId: 'commit', role: 'workflow_continuation', consequence: 'commit', goalRelevance: 1, continuity: 1, forwardProgress: 1 }
  ];
  assert.equal(chooseExecutableNavigation(scores, candidates)?.candidate.id, 'intermediate');
  assert.equal(chooseExecutableNavigation([scores[1]], candidates), null);
});

test('persistent memory records learned entity knowledge and only the selected traversal edge', () => {
  const memory = createSemanticMemory('Create a shipment');
  recordEntityKnowledge(memory, {
    structuralEntity: { id: 'entity:setup', label: 'Shipment setup', presentation: { route: '/setup' } }, structuralGraph: graph,
    semanticEntity: { semanticName: 'Shipment setup', description: 'Configures shipment' }, learnedRelationships: [{ kind: 'mutually_exclusive' }]
  });
  recordSelectedTransition(memory, {
    sourceEntityId: 'entity:setup', targetEntityId: 'entity:details', candidate: { id: 'continue', label: 'Continue', kind: 'action' },
    score: { role: 'workflow_continuation', goalRelevance: 0.9, continuity: 0.99, forwardProgress: 0.95 }, alternatives: [{ id: 'dashboard', label: 'Dashboard' }]
  });
  assert.equal(Object.keys(memory.entities).length, 1);
  assert.equal(memory.workflow.edges.length, 1);
  assert.equal(memory.workflow.edges[0].candidateId, 'continue');
  assert.deepEqual(memory.workflow.edges[0].retainedCandidateIds, ['dashboard']);
});
