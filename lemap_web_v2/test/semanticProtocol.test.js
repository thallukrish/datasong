import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSemanticCandidates, buildSemanticRequest, normalizeSemanticResponse, buildNavigationRequest, normalizeNavigationResponse } from '../src/semantic/semanticProtocol.js';

function control(id, name, semantic = {}, structural = {}) {
  return { id, type: 'ui_control', name, structural: { controlType: 'text', label: name, ...structural }, semantic, links: [] };
}

test('selects only unresolved non-navigation entities', () => {
  const entities = [
    control('a', 'Income'),
    control('b', 'Address', { meaning: 'Postal address', interaction: 'user_input', relevantToGoal: true, required: true, question: 'Address?' }),
    control('c', 'Continue', {}, { controlType: 'button' })
  ];
  assert.deepEqual(selectSemanticCandidates(entities).map((e) => e.id), ['a']);
});

test('semantic request is compact and omits runtime state', () => {
  const field = control('a', 'Filing status', {}, { controlType: 'radio', values: ['Individual', 'Company'], value: 'Individual', domId: 'radio-2' });
  field.links = [{ id: 'page:1', relationship: 'partOf' }];
  const request = buildSemanticRequest({ query: 'File return', workflowPages: [{ id: 'page:0', name: 'Login' }], currentPage: { id: 'page:1', name: 'Return' }, entities: [field] });
  assert.deepEqual(request.entities, [{ id: 'a', name: 'Filing status', type: 'ui_control', controlType: 'radio', choices: ['Individual', 'Company'] }]);
  const serialized = JSON.stringify(request);
  assert.equal(serialized.includes('radio-2'), false);
  assert.equal(serialized.includes('partOf'), false);
  assert.equal(serialized.includes('"value":"Individual"'), false);
});

test('semantic response is whitelisted', () => {
  const normalized = normalizeSemanticResponse({ entities: [{ id: 'a', structural: { label: 'Other' }, semantic: { meaning: 'Filing status', interaction: 'user_input', relevantToGoal: true, required: true, question: 'What is your filing status?', examples: ['Individual'], extra: 'drop' } }] }, ['a']);
  assert.deepEqual(normalized, [{ entityId: 'a', semantic: { meaning: 'Filing status', interaction: 'user_input', relevantToGoal: true, required: true, question: 'What is your filing status?', examples: ['Individual'] } }]);
});

test('navigation request is compact', () => {
  const request = buildNavigationRequest({ query: 'File return', workflowPages: [{ id: 'p1', name: 'Dashboard' }], currentPage: { id: 'p2', name: 'Return' }, candidates: [control('next', 'Continue', {}, { controlType: 'button', domId: 'continue-btn' })] });
  assert.deepEqual(request.candidates, [{ id: 'next', label: 'Continue', controlType: 'button' }]);
  assert.equal(JSON.stringify(request).includes('continue-btn'), false);
});

test('navigation response only accepts supplied ids', () => {
  assert.equal(normalizeNavigationResponse({ selectedEntityId: 'next' }, ['next', 'back']), 'next');
  assert.equal(normalizeNavigationResponse({ selectedEntityId: 'invented' }, ['next']), '');
});
