import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntitySemanticPrompt, normalizeEntitySemanticResponse } from '../src/semantic/entitySemanticResolver.js';

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
  structural: { controlType: 'button' },
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

test('action/navigation semantics default missing priority to zero instead of remaining unresolved forever', () => {
  const result = normalizeEntitySemanticResponse({
    entities: [{ id: action.id, semantic: { interaction: 'navigation', workflowRole: 'continue', consequence: 'reversible', relevantToGoal: true } }]
  }, [action]);
  assert.equal(result.entities[0].semantic.navigationPriority, 0);
});
