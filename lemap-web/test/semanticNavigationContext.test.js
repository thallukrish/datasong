import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntitySemanticPrompt,
  buildNavigationSemanticPrompt,
  entitiesNeedingSemantics,
  normalizeEntitySemanticResponse
} from '../src/semantic/entitySemanticResolver.js';

const page = {
  id: 'page:itr3',
  name: 'ITR 3 - Income Tax Return 3',
  type: 'page',
  structural: { route: '/itr3' },
  semantic: { meaning: 'ITR-3 return preparation page' },
  links: []
};
const action = {
  id: 'button:start',
  name: "Let's Get Started",
  type: 'ui_control',
  structural: { controlType: 'button', visible: true, disabled: false },
  semantic: {},
  links: []
};

test('semantic prompt includes known current page as read-only context', () => {
  const prompt = buildEntitySemanticPrompt({
    userGoal: 'File ITR-3',
    entities: [action],
    pageId: page.id,
    pageContext: page
  });
  assert.match(prompt, /pageContext/);
  assert.match(prompt, /ITR 3 - Income Tax Return 3/);
  assert.match(prompt, /ITR-3 return preparation page/);
  assert.match(prompt, /reference only/i);
});

test('navigation prompt includes compact ordered workflow trail so prior-step links can be classified as back', () => {
  const prompt = buildNavigationSemanticPrompt({
    userGoal: 'File ITR-3',
    pageContext: { id: 'page:returns', name: 'Income Tax Returns', type: 'page', semantic: {} },
    recentPageTrail: [
      { id: 'page:file', name: 'File Income Tax Return' },
      { id: 'page:status', name: 'Please select the status applicable to you to proceed further' },
      { id: 'page:returns', name: 'Income Tax Returns' }
    ],
    entities: [{
      id: 'link:status',
      name: 'Select Status',
      type: 'ui_control',
      structural: { controlType: 'link', visible: true, disabled: false },
      semantic: {},
      links: []
    }]
  });
  assert.match(prompt, /recentPageTrail/);
  assert.match(prompt, /page:status/);
  assert.match(prompt, /Select Status/);
  assert.match(prompt, /earlier workflow step/i);
});

test('navigation prompt tells model that account profile and menu chrome are not workflow continuation by default', () => {
  const prompt = buildNavigationSemanticPrompt({
    userGoal: 'Complete a filing workflow',
    pageContext: page,
    entities: [{
      id: 'button:profile',
      name: 'expand_more Individual',
      type: 'ui_control',
      structural: { controlType: 'button', visible: true, disabled: false },
      semantic: {},
      links: []
    }]
  });
  assert.match(prompt, /account|profile/i);
  assert.match(prompt, /menu|site chrome/i);
  assert.match(prompt, /not.*continue|never.*continue/i);
});

test('disabled navigation controls wait for semantics until they become executable', () => {
  const disabled = {
    id: 'button:later', name: 'Continue', type: 'ui_control',
    structural: { controlType: 'button', visible: true, disabled: true }, semantic: {}, links: []
  };
  const enabled = { ...disabled, structural: { ...disabled.structural, disabled: false } };
  assert.deepEqual(entitiesNeedingSemantics([disabled]).map((entity) => entity.id), []);
  assert.deepEqual(entitiesNeedingSemantics([enabled]).map((entity) => entity.id), ['button:later']);
});

test('action/navigation semantics default missing priority to zero instead of remaining unresolved forever', () => {
  const result = normalizeEntitySemanticResponse({
    entities: [{ id: action.id, semantic: { interaction: 'navigation', workflowRole: 'continue', consequence: 'reversible', relevantToGoal: true } }]
  }, [action]);
  assert.equal(result.entities[0].semantic.navigationPriority, 0);
});
