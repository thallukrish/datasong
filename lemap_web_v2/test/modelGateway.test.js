import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelGateway } from '../src/semantic/modelGateway.js';

test('model gateway forwards only the compact approved payload', async () => {
  let received;
  const gateway = createModelGateway({ invoke: async (request) => { received = request; return { ok: true }; } });
  const result = await gateway.run({ operation: 'enrich_entities', payload: { query: 'File return', entities: [{ id: 'a', name: 'Income', type: 'ui_control', controlType: 'text' }] } });
  assert.deepEqual(result, { ok: true });
  assert.equal(received.operation, 'enrich_entities');
  assert.deepEqual(received.payload.entities[0], { id: 'a', name: 'Income', type: 'ui_control', controlType: 'text' });
  assert.equal('graph' in received, false);
  assert.equal('instanceGraph' in received, false);
});

test('model gateway logs the exact safe request and structured response', async () => {
  const events = [];
  const logger = {
    logModelInput: async (request) => events.push(['input', structuredClone(request)]),
    logModelOutput: async (operation, response) => events.push(['output', operation, structuredClone(response)])
  };
  const response = { selectedEntityId: 'next' };
  const gateway = createModelGateway({
    invoke: async () => response,
    logger
  });
  const request = { operation: 'choose_navigation', payload: { query: 'continue', candidates: [{ id: 'next', label: 'Continue' }] } };

  const result = await gateway.run(request);

  assert.deepEqual(result, response);
  assert.deepEqual(events, [
    ['input', request],
    ['output', 'choose_navigation', response]
  ]);
});

test('model gateway records safe failure metadata and preserves it for the outer runner', async () => {
  const events = [];
  const failure = new Error('provider detail that must not be copied into runtime diagnostics');
  failure.code = 'MODEL_HTTP_ERROR';
  failure.statusCode = 503;
  failure.retryable = true;
  const gateway = createModelGateway({
    invoke: async () => { throw failure; },
    logger: {
      logModelInput: async () => {},
      logModelOutput: async () => {},
      logModelError: async (operation, error) => events.push([operation, error.code, error.statusCode, error.retryable])
    }
  });

  await assert.rejects(async () => {
    await gateway.run({ operation: 'enrich_entities', payload: { query: 'q', entities: [] } });
  }, (error) => {
    assert.equal(error, failure);
    assert.equal(error.lemapStage, 'model_gateway');
    assert.equal(error.lemapOperation, 'enrich_entities');
    return true;
  });
  assert.deepEqual(events, [['enrich_entities', 'MODEL_HTTP_ERROR', 503, true]]);
});

test('model gateway rejects runtime-shaped fields before provider invocation or logging', async () => {
  let calls = 0;
  let logs = 0;
  const gateway = createModelGateway({
    invoke: async () => { calls += 1; return {}; },
    logger: {
      logModelInput: async () => { logs += 1; },
      logModelOutput: async () => { logs += 1; }
    }
  });
  await assert.rejects(() => gateway.run({ operation: 'enrich_entities', payload: { entities: [{ id: 'a', value: 'runtime' }] } }), /runtime/i);
  assert.equal(calls, 0);
  assert.equal(logs, 0);
});

test('model gateway rejects missing provider invocation function', () => {
  assert.throws(() => createModelGateway(), /invoke/i);
  assert.throws(() => createModelGateway({ invoke: 'no' }), /invoke/i);
});

test('model gateway rejects malformed requests before calling provider', async () => {
  let calls = 0;
  const gateway = createModelGateway({ invoke: async () => { calls += 1; return {}; } });
  await assert.rejects(() => gateway.run({ operation: '', payload: {} }), /operation/i);
  await assert.rejects(() => gateway.run({ operation: 'x', payload: [] }), /payload/i);
  assert.equal(calls, 0);
});
