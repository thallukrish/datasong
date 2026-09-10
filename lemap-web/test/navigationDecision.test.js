import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNavigationChoicePrompt,
  normalizeNavigationChoiceResponse,
  chooseNavigationCandidate
} from '../src/agent/navigationDecision.js';

const candidates = [
  { id: 'action:a', name: 'Primary action', type: 'ui_control', structural: { controlType: 'button', visible: true, disabled: false } },
  { id: 'action:b', name: 'Alternate action', type: 'ui_control', structural: { controlType: 'link', visible: true, disabled: false } }
];

const page = { id: 'page:3', name: 'Current workflow page', type: 'page', semantic: { meaning: 'Current step' } };
const trail = [
  { id: 'page:1', name: 'First page' },
  { id: 'page:2', name: 'Second page' },
  { id: 'page:3', name: 'Current workflow page' }
];

test('navigation choice prompt asks only which remaining candidate best continues the workflow', () => {
  const prompt = buildNavigationChoicePrompt({
    userGoal: 'Complete the task',
    candidates,
    pageContext: page,
    recentPageTrail: trail
  });

  assert.match(prompt, /Complete the task/);
  assert.match(prompt, /Current workflow page/);
  assert.match(prompt, /First page/);
  assert.match(prompt, /Primary action/);
  assert.match(prompt, /Alternate action/);
  assert.match(prompt, /selectedEntityId/);
  assert.doesNotMatch(prompt, /workflowRole|navigationPriority|consequence|financial|destructive|security/i);
});

test('navigation choice response only accepts an id from the supplied candidates', () => {
  assert.deepEqual(
    normalizeNavigationChoiceResponse({ selectedEntityId: 'action:b' }, candidates),
    { selectedEntityId: 'action:b' }
  );
  assert.deepEqual(
    normalizeNavigationChoiceResponse({ selectedEntityId: 'made-up' }, candidates),
    { selectedEntityId: '' }
  );
});

test('single remaining candidate is selected without a model call', async () => {
  let calls = 0;
  const result = await chooseNavigationCandidate({
    client: { chat: { completions: { create: async () => { calls += 1; throw new Error('model should not be called'); } } } },
    model: 'test-model',
    userGoal: 'Complete the task',
    candidates: [candidates[0]],
    pageContext: page,
    recentPageTrail: trail
  });

  assert.equal(result?.id, 'action:a');
  assert.equal(calls, 0);
});

test('multiple remaining candidates are reduced to the model-selected action', async () => {
  const client = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ selectedEntityId: 'action:b' }) } }],
          usage: { total_tokens: 10 }
        })
      }
    }
  };

  const result = await chooseNavigationCandidate({
    client,
    model: 'test-model',
    userGoal: 'Complete the task',
    candidates,
    pageContext: page,
    recentPageTrail: trail
  });

  assert.equal(result?.id, 'action:b');
});
