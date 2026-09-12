import test from 'node:test';
import assert from 'node:assert/strict';
import { runConfiguredApplication } from '../src/app/bootstrap.js';

test('runConfiguredApplication composes browser, persistence, logger, gateway and runner', async () => {
  const calls = [];
  const config = {
    browser: { cdpUrl: 'http://127.0.0.1:9222' },
    model: { provider: 'openai-compatible', name: 'model-x', endpoint: 'https://model.test/v1', apiKey: 'k' },
    storage: { entityGraphPath: 'e.json', instanceGraphPath: 'i.json', workflowLogPath: 'wf' },
    runtime: { maxSteps: 7 }
  };
  const page = { id: 'page-object' };
  const state = { entityGraph: { entities: [] }, instanceGraph: { instances: [] }, workflow: { id: 'wf:1', steps: [] }, contextStack: null };
  const logger = { path: 'data/logs/layer27-run.jsonl', log: async (type, data) => calls.push(['log', type, data]) };
  let closed = false;

  const result = await runConfiguredApplication({
    config,
    workflowId: 'wf:1',
    query: 'file my return',
    requestInput: async () => 'x',
    deps: {
      connectBrowserSession: async () => ({ page, close: async () => { closed = true; } }),
      createRunLogger: async () => logger,
      createProviderInvoke: () => async () => ({ patches: [] }),
      createModelGateway: ({ invoke, logger: receivedLogger }) => {
        assert.equal(receivedLogger, logger);
        return { run: invoke };
      },
      loadPersistentRunState: async (args) => { calls.push(['load', args.workflowId]); return state; },
      checkpointRunState: async () => calls.push(['checkpoint']),
      runApplication: async (args) => {
        calls.push(['run', args.page, args.maxSteps, typeof args.gateway.run, args.logger !== logger, args.logger.path]);
        await args.checkpoint(state);
        return { reason: 'completed', steps: 0, state };
      }
    }
  });

  assert.equal(result.reason, 'completed');
  assert.equal(result.logPath, 'data/logs/layer27-run.jsonl');
  assert.deepEqual(calls, [
    ['log', 'run.start', { workflowId: 'wf:1' }],
    ['load', 'wf:1'],
    ['run', page, 7, 'function', true, 'data/logs/layer27-run.jsonl'],
    ['checkpoint'],
    ['log', 'run.stop', { workflowId: 'wf:1', completed: true, stage: 'completed', step: 0 }]
  ]);
  assert.equal(closed, true);
});

test('runConfiguredApplication always closes its CDP connection and logs safe model failure metadata', async () => {
  let closed = false;
  const logged = [];
  const failure = new Error('provider response body must not reach runtime logs');
  failure.code = 'MODEL_HTTP_ERROR';
  failure.statusCode = 503;
  failure.retryable = true;
  failure.lemapStage = 'model_gateway';
  failure.lemapOperation = 'enrich_entities';

  await assert.rejects(() => runConfiguredApplication({
    config: {
      browser: { cdpUrl: 'http://127.0.0.1:9222' },
      model: { provider: 'x', name: 'm', endpoint: 'https://model.test', apiKey: 'k' },
      storage: { entityGraphPath: 'e', instanceGraphPath: 'i', workflowLogPath: 'w' },
      runtime: { maxSteps: 3 }
    },
    workflowId: 'wf:1',
    query: 'q',
    deps: {
      connectBrowserSession: async () => ({ page: {}, close: async () => { closed = true; } }),
      createRunLogger: async () => ({ path: 'x.jsonl', log: async (type, data) => logged.push([type, data]) }),
      createProviderInvoke: () => async () => ({}),
      createModelGateway: () => ({ run: async () => ({}) }),
      loadPersistentRunState: async () => ({ entityGraph: { entities: [] }, instanceGraph: { instances: [] }, workflow: { id: 'wf:1', steps: [] }, contextStack: null }),
      checkpointRunState: async () => {},
      runApplication: async () => { throw failure; }
    }
  }), /provider response body/);

  assert.equal(closed, true);
  assert.deepEqual(logged.at(-1), ['run.error', {
    workflowId: 'wf:1',
    errorCode: 'MODEL_HTTP_ERROR',
    stage: 'model_gateway',
    operation: 'enrich_entities',
    statusCode: 503,
    retryable: true
  }]);
  assert.equal(JSON.stringify(logged).includes('provider response body'), false);
});
