import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntitySemanticPrompt,
  buildNavigationSemanticPrompt,
  entitiesNeedingSemantics
} from '../src/semantic/entitySemanticResolver.js';

const page = {
  id: 'page:3',
  name: 'Current workflow page',
  type: 'page',
  structural: { route: '/current' },
  semantic: { meaning: 'Current step' },
  links: []
};
const action = {
  id: 'button:start',
  name: 'Primary action',
  type: 'ui_control',
  structural: { controlType: 'button', visible: true, disabled: false },
  semantic: {},
  links: []
};

test('semantic prompt includes known current page as read-only context', () => {
  const prompt = buildEntitySemanticPrompt({
    userGoal: 'Complete workflow',
    entities: [action],
    pageId: page.id,
    pageContext: page
  });
  assert.match(prompt, /pageContext/);
  assert.match(prompt, /Current workflow page/);
  assert.match(prompt, /Current step/);
  assert.match(prompt, /reference only/i);
});

test('navigation choice prompt includes ordered workflow trail and remaining candidate labels', () => {
  const prompt = buildNavigationSemanticPrompt({
    userGoal: 'Complete workflow',
    pageContext: page,
    recentPageTrail: [
      { id: 'page:1', name: 'First page' },
      { id: 'page:2', name: 'Second page' },
      { id: 'page:3', name: 'Current workflow page' }
    ],
    entities: [action]
  });
  assert.match(prompt, /workflowPages/);
  assert.match(prompt, /page:1/);
  assert.match(prompt, /Primary action/);
  assert.match(prompt, /selectedEntityId/);
  assert.doesNotMatch(prompt, /workflowRole|navigationPriority|consequence/i);
});

test('disabled actions are not semantic candidates until executable', () => {
  const disabled = {
    id: 'button:later', name: 'Candidate', type: 'ui_control',
    structural: { controlType: 'button', visible: true, disabled: true }, semantic: {}, links: []
  };
  const enabled = { ...disabled, structural: { ...disabled.structural, disabled: false } };
  assert.deepEqual(entitiesNeedingSemantics([disabled]).map((entity) => entity.id), []);
  assert.deepEqual(entitiesNeedingSemantics([enabled]).map((entity) => entity.id), ['button:later']);
});

test('required user input remains a candidate until it has a structural value', () => {
  const input = {
    id: 'group:choice', name: 'Choice', type: 'group',
    structural: { cardinality: 'exactlyOne', value: null },
    semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Choose?' },
    links: []
  };
  assert.deepEqual(entitiesNeedingSemantics([input]).map((entity) => entity.id), ['group:choice']);
  const answered = { ...input, structural: { ...input.structural, value: 'A' } };
  assert.deepEqual(entitiesNeedingSemantics([answered]).map((entity) => entity.id), []);
});
