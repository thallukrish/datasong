import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntitySemanticPrompt,
  normalizeEntitySemanticResponse,
  resolveEntitySemantics
} from '../src/semantic/entitySemanticResolver.js';

const entities = [
  { id: 'page:1', name: 'Setup', type: 'page', structural: { route: '/setup' }, semantic: {}, links: [{ id: 'field:year', relationship: 'contains' }] },
  { id: 'field:year', name: 'Assessment Year', type: 'ui_control', structural: { controlType: 'select', values: ['2026-27', '2025-26'], disabled: false }, semantic: {}, links: [{ id: 'page:1', relationship: 'childOf' }] },
  { id: 'button:continue', name: 'Continue', type: 'ui_control', structural: { controlType: 'button', disabled: true }, semantic: {}, links: [{ id: 'page:1', relationship: 'childOf' }] }
];

test('semantic resolver prompt sends entity ids and structure but asks model to return semantics only', () => {
  const prompt = buildEntitySemanticPrompt({ userGoal: 'Complete setup', entities, pageId: 'page:1' });
  assert.match(prompt, /web-entity-semantics-v1/);
  assert.match(prompt, /field:year/);
  assert.match(prompt, /Assessment Year/);
  assert.match(prompt, /semantic additions only/i);
  assert.match(prompt, /consequence/i);
});

test('semantic response accepts only known entity ids and optional semantic fields', () => {
  const result = normalizeEntitySemanticResponse({
    entities: [
      { id: 'field:year', semantic: { meaning: 'assessment year', scope: 'local', interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which year?', explanation: 'Choose the year.', caveats: ['Use the applicable year.'], examples: ['2026-27'] } },
      { id: 'button:continue', semantic: { interaction: 'navigation', workflowRole: 'continue', consequence: 'reversible', relevantToGoal: true } },
      { id: 'made-up', semantic: { meaning: 'invented' } }
    ],
    workflow: { name: 'Complete setup', description: 'Move through setup.' }
  }, entities);

  assert.equal(result.entities.length, 2);
  assert.equal(result.entities[0].id, 'field:year');
  assert.equal(result.entities[0].semantic.scope, 'local');
  assert.equal(result.entities[0].semantic.interaction, 'user_input');
  assert.deepEqual(result.entities[0].semantic.examples, ['2026-27']);
  assert.equal(result.entities[1].semantic.consequence, 'reversible');
});

test('semantic resolver executes through injected model client', async () => {
  const client = { chat: { completions: { create: async () => ({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ entities: [{ id: 'button:continue', semantic: { interaction: 'navigation', workflowRole: 'continue', consequence: 'reversible', relevantToGoal: true } }] }) } }],
    usage: { total_tokens: 10 }
  }) } } };

  const result = await resolveEntitySemantics({ client, model: 'test-model', userGoal: 'Complete setup', entities, pageId: 'page:1' });
  assert.equal(result.entities[0].id, 'button:continue');
  assert.equal(result.entities[0].semantic.workflowRole, 'continue');
  assert.equal(result.entities[0].semantic.consequence, 'reversible');
});
