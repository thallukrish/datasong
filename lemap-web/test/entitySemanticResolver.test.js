import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntitySemanticPrompt,
  buildNavigationSemanticPrompt,
  entitiesNeedingSemantics,
  normalizeEntitySemanticResponse,
  normalizeNavigationSemanticResponse,
  partitionSemanticCandidates,
  resolveEntitySemantics
} from '../src/semantic/entitySemanticResolver.js';

const workflow = { id: 'workflow:1', name: 'Complete setup', type: 'workflow', structural: { goal: 'Complete setup' }, semantic: {}, links: [] };
const page = { id: 'page:1', name: 'Setup', type: 'page', structural: { route: '/setup' }, semantic: {}, links: [] };
const input = { id: 'field:value', name: 'Value', type: 'ui_control', structural: { controlType: 'select', values: ['A', 'B'], value: null, disabled: false }, semantic: {}, links: [] };
const action = { id: 'button:a', name: 'Primary action', type: 'ui_control', structural: { controlType: 'button', visible: true, disabled: false }, semantic: {}, links: [] };

test('entity semantic prompt stays focused on unresolved non-navigation entities', () => {
  const prompt = buildEntitySemanticPrompt({ userGoal: 'Complete setup', entities: [input], pageId: page.id, knownWorkflow: workflow, pageContext: page });
  assert.match(prompt, /web-entity-semantics-v1/);
  assert.match(prompt, /workflow:1/);
  assert.match(prompt, /field:value/);
  assert.match(prompt, /pageContext/);
  assert.doesNotMatch(prompt, /navigationPriority|consequence/);
});

test('semantic candidates split clickable actions from entity interpretation', () => {
  const group = { id: 'group:mode', name: 'Mode', type: 'group', structural: { cardinality: 'exactlyOne', values: ['A', 'B'] }, semantic: {}, links: [] };
  const split = partitionSemanticCandidates([workflow, page, group, input, action]);
  assert.deepEqual(split.navigation.map((entity) => entity.id), ['button:a']);
  assert.deepEqual(split.entity.map((entity) => entity.id), ['workflow:1', 'page:1', 'group:mode', 'field:value']);
});

test('grouped members are structural choices rather than separate semantic questions', () => {
  const group = {
    id: 'group:mode', name: 'Mode', type: 'group', structural: { cardinality: 'exactlyOne', values: ['A', 'B'] }, semantic: {},
    links: [{ id: 'field:a', relationship: 'contains' }, { id: 'field:b', relationship: 'contains' }]
  };
  const memberA = { id: 'field:a', name: 'A', type: 'ui_control', structural: { controlType: 'radio' }, semantic: {}, links: [{ id: group.id, relationship: 'partOf' }] };
  const memberB = { id: 'field:b', name: 'B', type: 'ui_control', structural: { controlType: 'radio' }, semantic: {}, links: [{ id: group.id, relationship: 'partOf' }] };
  assert.deepEqual(entitiesNeedingSemantics([group, memberA, memberB]).map((entity) => entity.id), ['group:mode']);
});

test('required input remains unresolved until its current structural value is present', () => {
  const knownInput = {
    ...input,
    semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which value?' }
  };
  assert.deepEqual(entitiesNeedingSemantics([knownInput]).map((entity) => entity.id), ['field:value']);
  const answered = { ...knownInput, structural: { ...knownInput.structural, value: 'A' } };
  assert.deepEqual(entitiesNeedingSemantics([answered]).map((entity) => entity.id), []);
});

test('navigation prompt is only a candidate-selection request', () => {
  const prompt = buildNavigationSemanticPrompt({
    userGoal: 'Complete setup',
    pageContext: page,
    recentPageTrail: [{ id: 'page:0', name: 'Earlier page' }, { id: page.id, name: page.name }],
    entities: [action, { ...action, id: 'button:b', name: 'Alternate action' }]
  });
  assert.match(prompt, /web-navigation-choice-v1/);
  assert.match(prompt, /selectedEntityId/);
  assert.match(prompt, /Earlier page/);
  assert.match(prompt, /Primary action/);
  assert.doesNotMatch(prompt, /workflowRole|navigationPriority|consequence|financial|destructive|security/i);
});

test('navigation compatibility normalization turns only the selected id into a continuation patch', () => {
  const result = normalizeNavigationSemanticResponse({ selectedEntityId: action.id }, [action]);
  assert.equal(result.entities.length, 1);
  assert.equal(result.entities[0].id, action.id);
  assert.equal(result.entities[0].semantic.workflowRole, 'continue');
  assert.equal(result.entities[0].semantic.consequence, 'reversible');

  assert.deepEqual(normalizeNavigationSemanticResponse({ selectedEntityId: 'made-up' }, [action]), { entities: [] });
});

test('general semantic normalization accepts input and workflow meaning without navigation classification', () => {
  const result = normalizeEntitySemanticResponse({
    entities: [
      { id: workflow.id, semantic: { description: 'Complete setup.', complete: false, relevantToGoal: true } },
      { id: input.id, semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which value?', selectionRule: 'exactlyOne' } }
    ]
  }, [workflow, input]);
  assert.equal(result.entities.find((item) => item.id === workflow.id).semantic.complete, false);
  assert.equal(result.entities.find((item) => item.id === input.id).semantic.question, 'Which value?');
});

test('resolver does not ask navigation model while a required input is still unanswered', async () => {
  const prompts = [];
  const client = { chat: { completions: { create: async ({ messages }) => {
    const promptText = messages[1].content;
    prompts.push(promptText);
    return {
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        entities: [{ id: input.id, semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which value?' } }]
      }) } }],
      usage: { total_tokens: 10 }
    };
  } } } };

  const result = await resolveEntitySemantics({ client, model: 'test-model', userGoal: 'Complete setup', entities: [input, action], pageId: page.id, pageContext: page });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /web-entity-semantics-v1/);
  assert.equal(result.entities.some((item) => item.id === action.id), false);
});

test('resolver asks navigation model to select one action after required inputs are satisfied', async () => {
  const prompts = [];
  const answeredInput = {
    ...input,
    structural: { ...input.structural, value: 'A' },
    semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which value?' }
  };
  const secondAction = { ...action, id: 'button:b', name: 'Alternate action' };
  const client = { chat: { completions: { create: async ({ messages }) => {
    const promptText = messages[1].content;
    prompts.push(promptText);
    if (/web-navigation-choice-v1/.test(promptText)) {
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ selectedEntityId: secondAction.id }) } }], usage: { total_tokens: 10 } };
    }
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ entities: [] }) } }], usage: { total_tokens: 10 } };
  } } } };

  const result = await resolveEntitySemantics({ client, model: 'test-model', userGoal: 'Complete setup', entities: [answeredInput, action, secondAction], pageId: page.id, pageContext: page, recentPageTrail: [{ id: page.id, name: page.name }] });
  assert.ok(prompts.some((item) => /web-navigation-choice-v1/.test(item)));
  assert.equal(result.entities.find((item) => item.id === secondAction.id)?.semantic.workflowRole, 'continue');
});
