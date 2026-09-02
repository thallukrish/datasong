import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserQuestions, normalizeUserAnswerResponse, buildUserAnswerPrompt } from '../src/agent/userInput.js';
import { buildNavigationPrompt, normalizeNavigationResponse } from '../src/semantic/navigationScout.js';
import { createSemanticMemory, recordEntityKnowledge, recordSelectedTransition } from '../src/agent/memory.js';
import { fieldInteractionKind } from '../src/agent/browserActions.js';

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
