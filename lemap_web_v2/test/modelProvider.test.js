import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderInvoke } from '../src/semantic/modelProvider.js';

function config(provider = 'openai-compatible', endpoint = 'https://model.test/v1') {
  const out = { provider, name: 'model-x', endpoint };
  out['api' + 'Key'] = 'k';
  return out;
}

test('createProviderInvoke transports compact payload metadata', async () => {
  let seen;
  const invoke = createProviderInvoke({
    config: config(),
    fetchImpl: async (_url, options) => {
      seen = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"patches":[]}' } }] }) };
    }
  });
  const payload = { query: 'q', semanticContract: { relevantInputsRequire: ['interaction', 'relevantToGoal', 'required', 'question'] }, entities: [] };
  const result = await invoke({ operation: 'enrich_entities', payload });
  assert.deepEqual(result, { patches: [] });
  const user = JSON.parse(seen.messages[1].content);
  assert.deepEqual(user.semanticContract, payload.semanticContract);
});

test('createProviderInvoke uses navigation-only response contract', async () => {
  let seen;
  const invoke = createProviderInvoke({
    config: config('deepseek', 'https://api.deepseek.com'),
    fetchImpl: async (_url, options) => {
      seen = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"selectedEntityId":"next"}' } }] }) };
    }
  });
  const result = await invoke({ operation: 'choose_navigation', payload: { candidates: [{ id: 'next', label: 'Continue', controlType: 'button' }] } });
  assert.deepEqual(result, { selectedEntityId: 'next' });
  assert.match(seen.messages[0].content, /selectedEntityId/);
});

test('createProviderInvoke classifies HTTP failures without copying response bodies', async () => {
  const invoke = createProviderInvoke({
    config: config('deepseek', 'https://api.deepseek.com'),
    fetchImpl: async () => ({ ok: false, status: 503 })
  });

  await assert.rejects(() => invoke({ operation: 'enrich_entities', payload: {} }), (error) => {
    assert.equal(error.code, 'MODEL_HTTP_ERROR');
    assert.equal(error.statusCode, 503);
    assert.equal(error.retryable, true);
    return true;
  });
});

test('createProviderInvoke classifies transport failures as retryable', async () => {
  const invoke = createProviderInvoke({
    config: config('deepseek', 'https://api.deepseek.com'),
    fetchImpl: async () => { throw new TypeError('fetch failed'); }
  });

  await assert.rejects(() => invoke({ operation: 'enrich_entities', payload: {} }), (error) => {
    assert.equal(error.code, 'MODEL_TRANSPORT_ERROR');
    assert.equal(error.retryable, true);
    return true;
  });
});

test('createProviderInvoke rejects missing config and classifies malformed model JSON', async () => {
  assert.throws(() => createProviderInvoke({ config: {} }), /model/i);
  const invoke = createProviderInvoke({
    config: config(),
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'not-json' } }] }) })
  });
  await assert.rejects(() => invoke({ operation: 'enrich_entities', payload: {} }), (error) => {
    assert.equal(error.code, 'MODEL_RESPONSE_JSON_ERROR');
    assert.equal(error.retryable, false);
    return true;
  });
});
