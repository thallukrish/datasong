import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntitySemanticPrompt,
  normalizeEntitySemanticResponse
} from '../src/semantic/entitySemanticResolver.js';

const group = {
  id: 'group:mode',
  name: 'Preparation mode',
  type: 'group',
  structural: { cardinality: 'exactlyOne', values: ['Online', 'Offline'], visible: true, disabled: false },
  semantic: {},
  links: []
};

const textInput = {
  id: 'field:amount',
  name: 'Amount',
  type: 'ui_control',
  structural: { controlType: 'text', visible: true, disabled: false, values: [] },
  semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'What amount?' },
  links: []
};

test('learning semantic prompt adds compact answer choices on the first semantic call', () => {
  const prompt = buildEntitySemanticPrompt({
    userGoal: 'Complete setup',
    entities: [group, textInput],
    pageId: 'page:1',
    learning: true
  });
  assert.match(prompt, /web-entity-semantics-v1/);
  assert.match(prompt, /learningAnswer/);
  assert.match(prompt, /"key":"1","label":"Online"/);
  assert.match(prompt, /"key":"2","label":"Offline"/);
  assert.doesNotMatch(prompt, /web-learning-values/);
});

test('normal semantic prompt does not ask the model to invent values', () => {
  const prompt = buildEntitySemanticPrompt({
    userGoal: 'Complete setup',
    entities: [group],
    pageId: 'page:1',
    learning: false
  });
  assert.doesNotMatch(prompt, /learningAnswer/);
  assert.doesNotMatch(prompt, /"choices"/);
});

test('learning answers are normalized beside semantics and only for known entities', () => {
  const result = normalizeEntitySemanticResponse({
    entities: [
      { id: group.id, semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which mode?' }, learningAnswer: '2' },
      { id: textInput.id, semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'What amount?' }, learningAnswer: '1000' },
      { id: 'field:invented', semantic: {}, learningAnswer: 'secret' }
    ]
  }, [group, textInput], { learning: true });

  assert.equal(result.entities.find((item) => item.id === group.id)?.learningAnswer, '2');
  assert.equal(result.entities.find((item) => item.id === textInput.id)?.learningAnswer, '1000');
  assert.equal(result.entities.some((item) => item.id === 'field:invented'), false);
});

test('learning answer does not override semantic classification used by the shared traversal', () => {
  const result = normalizeEntitySemanticResponse({
    entities: [
      {
        id: group.id,
        semantic: { interaction: 'unknown', relevantToGoal: false, required: false },
        learningAnswer: '1'
      }
    ]
  }, [group], { learning: true });

  const item = result.entities[0];
  assert.equal(item.learningAnswer, '1');
  assert.equal(item.semantic.interaction, 'unknown');
  assert.equal(item.semantic.relevantToGoal, false);
  assert.equal(item.semantic.required, false);
});
