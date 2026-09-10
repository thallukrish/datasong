import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLearningValuePrompt,
  normalizeLearningValueResponse
} from '../src/agent/learningValueResolver.js';

const input = {
  id: 'group:mode',
  name: 'Preparation mode',
  type: 'group',
  structural: { cardinality: 'exactlyOne', values: ['Online', 'Offline'] },
  semantic: { question: 'How do you want to prepare the return?' }
};

const question = {
  entityId: input.id,
  label: 'How do you want to prepare the return?',
  options: ['Online', 'Offline'],
  finite: true,
  multiple: false,
  selectionRule: 'exactlyOne'
};

test('learning value prompt contains only the selected input question and compact choices', () => {
  const prompt = buildLearningValuePrompt({
    userGoal: 'Complete the filing flow',
    entity: input,
    question
  });

  assert.match(prompt, /MODE web-learning-value-v1/);
  assert.match(prompt, /"entityId":"group:mode"/);
  assert.match(prompt, /"key":"1","label":"Online"/);
  assert.match(prompt, /"key":"2","label":"Offline"/);
  assert.doesNotMatch(prompt, /semantic/);
  assert.doesNotMatch(prompt, /entities/);
});

test('learning value response returns only a proposed answer string', () => {
  assert.deepEqual(normalizeLearningValueResponse({ answer: '2' }), { answer: '2' });
  assert.deepEqual(normalizeLearningValueResponse({ answer: 1 }), { answer: '1' });
  assert.deepEqual(normalizeLearningValueResponse({}), { answer: '' });
});
