import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrame, createContextStack } from '../src/orchestrator/contextStack.js';
import { createInputStateLogger } from '../src/diagnostics/inputStateDiagnostics.js';

test('input diagnostics add entity instance and frame state without logging values', async () => {
  const events = [];
  const frame = createFrame({ kind: 'page', contextEntityId: 'page:a', pageEntityId: 'page:a', visibleEntityIds: ['control:year'] });
  const state = {
    instanceGraph: { version: 1, instances: [] },
    contextStack: createContextStack(frame)
  };
  const logger = createInputStateLogger({ log: async (type, data) => events.push([type, data]) }, state);

  await logger.log('input.required', { entityId: 'control:year', pageEntityId: 'page:a' });
  state.instanceGraph.instances.push({ entityId: 'control:year', value: '2026-27' });
  state.contextStack.frames[0].appliedEntityIds.push('control:year');
  await logger.log('input.applied', { entityId: 'control:year', pageEntityId: 'page:a' });

  assert.deepEqual(events[0], ['input.required', {
    entityId: 'control:year',
    pageEntityId: 'page:a',
    instanceExists: false,
    appliedInFrame: false
  }]);
  assert.deepEqual(events[1], ['input.applied', {
    entityId: 'control:year',
    pageEntityId: 'page:a',
    instanceExists: true,
    appliedInFrame: true
  }]);
  assert.equal(JSON.stringify(events).includes('2026-27'), false);
});
