import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityGraph } from '../src/graph/entityGraph.js';
import { createInstanceGraph } from '../src/graph/instanceGraph.js';
import { createWorkflow } from '../src/workflow/workflowTraversal.js';
import { createFrame, createContextStack } from '../src/orchestrator/contextStack.js';
import { runApplication } from '../src/app/applicationRunner.js';

function snapshot() {
  return { version: 1, url: 'https://example.test/a', title: 'A', root: { tag: 'body', directText: '', attributes: {}, children: [] } };
}

test('input diagnostics expose entity identity plus instance/applied state without values', async () => {
  const input = {
    id: 'control:year',
    type: 'ui_control',
    name: 'Assessment year',
    structural: { controlType: 'select' },
    semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Assessment year?' },
    links: []
  };
  const frame = createFrame({ kind: 'page', contextEntityId: 'page:a', pageEntityId: 'page:a', visibleEntityIds: [input.id] });
  const state = {
    entityGraph: createEntityGraph({ entities: [input] }),
    instanceGraph: createInstanceGraph(),
    workflow: createWorkflow({ id: 'wf:1', originalQuestion: 'file return' }),
    contextStack: createContextStack(frame)
  };
  const events = [];
  let requested = false;

  const result = await runApplication({
    state,
    page: {},
    query: 'q',
    gateway: {},
    logger: { log: async (type, data) => events.push([type, data]) },
    requestInput: async () => { requested = true; return '2026-27'; },
    deps: {
      captureVisibleDom: async () => snapshot(),
      enrichEntitySemantics: async () => ({ called: false }),
      selectReusableInput: () => null,
      selectNextRequiredInput: () => requested ? null : input,
      buildInputQuestion: () => ({ entityId: input.id, label: 'Assessment year?', options: [] }),
      applyInputValue: async () => {
        state.instanceGraph.instances.push({ entityId: input.id, value: '2026-27' });
        state.contextStack.frames[0].appliedEntityIds.push(input.id);
      },
      pageIdForSnapshot: () => 'page:a',
      refreshCurrentPage: () => {},
      selectNavigationCandidates: () => []
    }
  });

  assert.equal(result.reason, 'completed');
  const required = events.find(([type]) => type === 'input.required')?.[1];
  const applied = events.find(([type]) => type === 'input.applied')?.[1];
  assert.deepEqual({ entityId: required.entityId, instanceExists: required.instanceExists, appliedInFrame: required.appliedInFrame }, {
    entityId: input.id,
    instanceExists: false,
    appliedInFrame: false
  });
  assert.deepEqual({ entityId: applied.entityId, instanceExists: applied.instanceExists, appliedInFrame: applied.appliedInFrame }, {
    entityId: input.id,
    instanceExists: true,
    appliedInFrame: true
  });
  assert.equal(JSON.stringify(events).includes('2026-27'), false);
});
