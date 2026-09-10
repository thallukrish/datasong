import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntitySemanticPrompt } from '../src/semantic/entitySemanticResolver.js';
import { buildNavigationChoicePrompt } from '../src/agent/navigationDecision.js';
import { compactModelResult } from '../src/agent/runLogger.js';
import { callJsonModel } from '../src/semantic/modelCall.js';
import { clearRegisteredSensitiveValues, registerSensitiveValuesFromEntities } from '../src/semantic/modelPrivacy.js';

const personalValue = 'ZXCVB1234Q';
const personalName = 'Example Private Person';

function field(id, label, value) {
  return {
    id,
    name: label,
    type: 'ui_control',
    structural: { controlType: 'text', visible: true, disabled: false, value, defaultValue: null, values: [] },
    semantic: {},
    links: []
  };
}

test('entity semantic prompts redact live values wherever they appear in visible text', () => {
  const identifier = field('field:id', 'Identifier', personalValue);
  const name = field('field:name', 'Name', personalName);
  const page = {
    id: 'page:1',
    name: `Welcome ${personalName}`,
    type: 'page',
    structural: {},
    semantic: { meaning: `Account for ${personalName} / ${personalValue}` },
    links: []
  };
  const prompt = buildEntitySemanticPrompt({
    userGoal: 'Complete the workflow',
    entities: [page, identifier, name],
    pageId: page.id,
    pageContext: page
  });

  assert.equal(prompt.includes(personalName), false);
  assert.equal(prompt.includes(personalValue), false);
  assert.match(prompt, /\[redacted\]/i);
});

test('navigation prompts redact live values from page, trail and candidate labels', () => {
  const privacyEntities = [field('field:name', 'Name', personalName), field('field:id', 'Identifier', personalValue)];
  const prompt = buildNavigationChoicePrompt({
    userGoal: 'Complete the workflow',
    pageContext: { id: 'page:2', name: `Workspace for ${personalName}`, type: 'page', semantic: {} },
    recentPageTrail: [{ id: 'page:1', name: `Home ${personalName}` }],
    candidates: [{
      id: 'button:1',
      name: `Continue as ${personalName} ${personalValue}`,
      type: 'ui_control',
      structural: { controlType: 'button', visible: true, disabled: false },
      semantic: {},
      links: []
    }],
    privacyEntities
  });

  assert.equal(prompt.includes(personalName), false);
  assert.equal(prompt.includes(personalValue), false);
  assert.match(prompt, /\[redacted\]/i);
});

test('final model-call boundary redacts registered live values even if a caller forgets to sanitize', async () => {
  clearRegisteredSensitiveValues();
  registerSensitiveValuesFromEntities([field('field:name', 'Name', personalName), field('field:id', 'Identifier', personalValue)]);
  const requests = [];
  const client = { chat: { completions: { create: async (request) => {
    requests.push(request);
    return { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { total_tokens: 1 } };
  } } } };

  try {
    await callJsonModel({
      client,
      model: 'test-model',
      systemPrompt: `System mentions ${personalName}`,
      userPrompt: `Prompt mentions ${personalName} and ${personalValue}`
    });
  } finally {
    clearRegisteredSensitiveValues();
  }

  const serialized = JSON.stringify(requests);
  assert.equal(serialized.includes(personalName), false);
  assert.equal(serialized.includes(personalValue), false);
  assert.match(serialized, /\[redacted\]/i);
});

test('compact model logging never persists exact prompts or raw responses', () => {
  const summary = compactModelResult({
    purpose: 'entity_semantics',
    model: 'test-model',
    durationMs: 10,
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    systemPrompt: `secret ${personalName}`,
    userPrompt: `secret ${personalValue}`,
    raw: `{"value":"${personalValue}"}`,
    parsed: { selectedEntityId: 'button:1' }
  });

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(personalName), false);
  assert.equal(serialized.includes(personalValue), false);
  assert.equal(summary.exchange, undefined);
});
