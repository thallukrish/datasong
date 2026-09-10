import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntitySemanticPrompt,
  entitiesNeedingSemantics,
  normalizeEntitySemanticResponse,
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

test('semantic completeness is independent of whether the current DOM value is populated', () => {
  const knownInput = {
    ...input,
    semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which value?' }
  };
  assert.deepEqual(entitiesNeedingSemantics([knownInput]), []);
  const answered = { ...knownInput, structural: { ...knownInput.structural, value: 'A' } };
  assert.deepEqual(entitiesNeedingSemantics([answered]), []);
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

test('entity semantic resolver never performs navigation selection', async () => {
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
  assert.equal(prompts.some((item) => /web-navigation-choice-v1/.test(item)), false);
  assert.equal(result.entities.some((item) => item.id === action.id), false);
});
