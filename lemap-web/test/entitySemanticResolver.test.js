import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntitySemanticPrompt,
  normalizeEntitySemanticResponse,
  resolveEntitySemantics
} from '../src/semantic/entitySemanticResolver.js';

const workflow = { id: 'workflow:1', name: 'Complete setup', type: 'workflow', structural: { goal: 'Complete setup' }, semantic: {}, links: [{ id: 'page:1', relationship: 'contains' }] };
const pageEntities = [
  { id: 'page:1', name: 'Setup', type: 'page', structural: { route: '/setup' }, semantic: {}, links: [{ id: 'workflow:1', relationship: 'partOfWorkflow' }, { id: 'field:year', relationship: 'contains' }] },
  { id: 'field:year', name: 'Assessment Year', type: 'ui_control', structural: { controlType: 'select', values: ['2026-27', '2025-26'], disabled: false }, semantic: {}, links: [{ id: 'page:1', relationship: 'childOf' }] },
  { id: 'button:continue', name: 'Continue', type: 'ui_control', structural: { controlType: 'button', disabled: true }, semantic: {}, links: [{ id: 'page:1', relationship: 'childOf' }] }
];
const entities = [workflow, ...pageEntities];

test('semantic resolver prompt sends workflow, page and controls as ordinary entities', () => {
  const prompt = buildEntitySemanticPrompt({ userGoal: 'Complete setup', entities: pageEntities, pageId: 'page:1', knownWorkflow: workflow });
  assert.match(prompt, /web-entity-semantics-v1/);
  assert.match(prompt, /workflow:1/);
  assert.match(prompt, /field:year/);
  assert.match(prompt, /semantic additions only/i);
  assert.doesNotMatch(prompt, /workflow\?:/i);
});

test('semantic response accepts workflow completion as a normal semantic patch', () => {
  const result = normalizeEntitySemanticResponse({
    entities: [
      { id: 'workflow:1', semantic: { meaning: 'complete setup', description: 'Move through setup.', complete: false, relevantToGoal: true } },
      { id: 'field:year', semantic: { meaning: 'assessment year', scope: 'local', interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which year?', explanation: 'Choose the year.', caveats: ['Use the applicable year.'], examples: ['2026-27'] } },
      { id: 'button:continue', semantic: { interaction: 'navigation', workflowRole: 'continue', consequence: 'reversible', relevantToGoal: true } },
      { id: 'made-up', semantic: { meaning: 'invented' } }
    ]
  }, entities);

  assert.equal(result.entities.length, 3);
  const workflowPatch = result.entities.find((item) => item.id === 'workflow:1');
  assert.equal(workflowPatch.semantic.complete, false);
  assert.equal(workflowPatch.semantic.description, 'Move through setup.');
  assert.equal(result.entities.find((item) => item.id === 'button:continue').semantic.consequence, 'reversible');
});

test('semantic resolver injects known workflow into the same model entity set', async () => {
  let sentPrompt = '';
  const client = { chat: { completions: { create: async ({ messages }) => {
    sentPrompt = messages[1].content;
    return {
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ entities: [
        { id: 'workflow:1', semantic: { description: 'Move through setup.', complete: false, relevantToGoal: true } },
        { id: 'button:continue', semantic: { interaction: 'navigation', workflowRole: 'continue', consequence: 'reversible', relevantToGoal: true } }
      ] }) } }],
      usage: { total_tokens: 10 }
    };
  } } } };

  const result = await resolveEntitySemantics({ client, model: 'test-model', userGoal: 'Complete setup', entities: pageEntities, pageId: 'page:1', knownWorkflow: workflow });
  assert.match(sentPrompt, /workflow:1/);
  assert.equal(result.entities.find((item) => item.id === 'workflow:1').semantic.complete, false);
  assert.equal(result.entities.find((item) => item.id === 'button:continue').semantic.consequence, 'reversible');
});
