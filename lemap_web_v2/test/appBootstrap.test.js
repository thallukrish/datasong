import test from 'node:test';
import assert from 'node:assert/strict';
import { runConfiguredApplication } from '../src/app/bootstrap.js';

test('runConfiguredApplication composes browser, persistence, gateway and runner', async () => {
  const calls = [];
  const config = {
    browser: { cdpUrl: 'http://127.0.0.1:9222' },
    model: { provider: 'openai-compatible', name: 'model-x', endpoint: 'https://model.test/v1', apiKey: 'secret' },
    storage: { entityGraphPath: 'e.json', instanceGraphPath: 'i.json', workflowLogPath: 'wf' },
    runtime: { maxSteps: 7 }
  };
  const page = { id: 'page-object' };
  const state = { entityGraph: { entities: [] }, instanceGraph: { instances: [] }, workflow: { id: 'wf:1', steps: [] }, contextStack: null };
  let closed = false;

  const result = await runConfiguredApplication({
    config,
    workflowId: 'wf:1',
    query: 'file my return',
    requestInput: async () => 'x',
    deps: {
      connectBrowserSession: async () => ({ page, close: async () => { closed = true; } }),
      createProviderInvoke: () => async () => ({ patches: [] }),
      createModelGateway: ({ invoke }) => ({ run: invoke }),
      loadPersistentRunState: async (args) => { calls.push(['load', args.workflowId]); return state; },
      checkpointRunState: async () => calls.push(['checkpoint']),
      runApplication: async (args) => {
        calls.push(['run', args.page, args.maxSteps, typeof args.gateway.run]);
        await args.checkpoint(state);
        return { reason: 'completed', state };
      }
    }
  });

  assert.equal(result.reason, 'completed');
  assert.deepEqual(calls, [
    ['load', 'wf:1'],
    ['run', page, 7, 'function'],
    ['checkpoint']
  ]);
  assert.equal(closed, true);
});

test('runConfiguredApplication always closes its CDP connection when the runner fails', async () => {
  let closed = false;
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
      createProviderInvoke: () => async () => ({}),
      createModelGateway: () => ({ run: async () => ({}) }),
      loadPersistentRunState: async () => ({ entityGraph: { entities: [] }, instanceGraph: { instances: [] }, workflow: { id: 'wf:1', steps: [] }, contextStack: null }),
      checkpointRunState: async () => {},
      runApplication: async () => { throw new Error('boom'); }
    }
  }), /boom/);
  assert.equal(closed, true);
});
