import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderInvoke } from '../src/semantic/modelProvider.js';

test('createProviderInvoke sends canonical semantic contract', async () => {
  let seen;
  const invoke = createProviderInvoke({
    config: { provider: 'openai-compatible', name: 'model-x', endpoint: 'https://model.test/v1', apiKey: 'k' },
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"entities":[]}' } }] }) };
    }
  });

  const result = await invoke({ operation: 'enrich_entities', payload: { query: 'q', entities: [] } });
  assert.deepEqual(result, { entities: [] });
  const body = JSON.parse(seen.options.body);
  assert.match(body.messages[0].content, /interaction=user_input/i);
  assert.match(body.messages[0].content, /relevantToGoal/i);
  assert.match(body.messages[0].content, /required/i);
  assert.match(body.messages[0].content, /question/i);
  assert.doesNotMatch(body.messages[0].content, /patches/i);
});

test('createProviderInvoke uses navigation-only response contract', async () => {
  let seen;
  const invoke = createProviderInvoke({
    config: { provider: 'deepseek', name: 'm', endpoint: 'https://api.deepseek.com', apiKey: 'k' },
    fetchImpl: async (_url, options) => {
      seen = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"selectedEntityId":"next"}' } }] }) };
    }
  });
  const result = await invoke({ operation: 'choose_navigation', payload: { candidates: [{ id: 'next', label: 'Continue', controlType: 'button' }] } });
  assert.deepEqual(result, { selectedEntityId: 'next' });
  assert.match(seen.messages[0].content, /selectedEntityId/);
});

test('createProviderInvoke rejects missing config and malformed model JSON', async () => {
  assert.throws(() => createProviderInvoke({ config: {} }), /model/i);
  const invoke = createProviderInvoke({
    config: { provider: 'openai-compatible', name: 'm', endpoint: 'https://model.test', apiKey: 'k' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'not-json' } }] }) })
  });
  await assert.rejects(() => invoke({ operation: 'enrich_entities', payload: {} }), /json/i);
});
