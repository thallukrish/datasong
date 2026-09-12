import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderInvoke } from '../src/semantic/modelProvider.js';

test('createProviderInvoke sends one compact JSON request to an OpenAI-compatible endpoint', async () => {
  let seen;
  const invoke = createProviderInvoke({
    config: { provider: 'openai-compatible', name: 'model-x', endpoint: 'https://model.test/v1', apiKey: 'secret' },
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"patches":[]}' } }] })
      };
    }
  });

  const result = await invoke({ operation: 'enrich_entities', payload: { query: 'q', entities: [] } });

  assert.deepEqual(result, { patches: [] });
  assert.equal(seen.url, 'https://model.test/v1/chat/completions');
  const body = JSON.parse(seen.options.body);
  assert.equal(body.model, 'model-x');
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(seen.options.headers.authorization, 'Bearer secret');
});

test('createProviderInvoke rejects missing config and malformed model JSON', async () => {
  assert.throws(() => createProviderInvoke({ config: {} }), /model/i);

  const invoke = createProviderInvoke({
    config: { provider: 'openai-compatible', name: 'm', endpoint: 'https://model.test', apiKey: 'k' },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not-json' } }] })
    })
  });
  await assert.rejects(() => invoke({ operation: 'enrich_entities', payload: {} }), /json/i);
});
