import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityGraph } from '../src/graph/entityGraph.js';
import { createInstanceGraph } from '../src/graph/instanceGraph.js';
import { createWorkflow } from '../src/workflow/workflowTraversal.js';
import { createFrame, createContextStack } from '../src/orchestrator/contextStack.js';
import { runApplication, loadPersistentRunState, checkpointRunState } from '../src/app/applicationRunner.js';

function snapshot(url = 'https://example.test/a', title = 'A') {
  return { version: 1, url, title, root: { tag: 'body', directText: '', attributes: {}, children: [] } };
}

function state(pageId = 'page:a') {
  const frame = createFrame({ kind: 'page', contextEntityId: pageId, pageEntityId: pageId, visibleEntityIds: [] });
  return {
    entityGraph: createEntityGraph(),
    instanceGraph: createInstanceGraph(),
    workflow: createWorkflow({ id: 'wf:1', originalQuestion: 'file return' }),
    contextStack: createContextStack(frame)
  };
}

test('runApplication ingests the first page and stops when the workflow is complete', async () => {
  const current = { entityGraph: createEntityGraph(), instanceGraph: createInstanceGraph(), workflow: createWorkflow({ id: 'wf:1', originalQuestion: 'q' }), contextStack: null };
  const calls = [];
  const result = await runApplication({
    state: current,
    page: {},
    query: 'q',
    gateway: {},
    checkpoint: async () => calls.push('checkpoint'),
    deps: {
      captureVisibleDom: async () => snapshot(),
      ingestPageVisit: () => { calls.push('ingest'); current.contextStack = createContextStack(createFrame({ kind: 'page', contextEntityId: 'page:a', pageEntityId: 'page:a', visibleEntityIds: [] })); return { pageEntityId: 'page:a' }; },
      enrichEntitySemantics: async () => ({ called: false }),
      selectReusableInput: () => null,
      selectNextRequiredInput: () => null,
      selectNavigationCandidates: () => [],
      workflowComplete: () => true
    }
  });

  assert.equal(result.reason, 'completed');
  assert.deepEqual(calls, ['ingest', 'checkpoint', 'checkpoint']);
});

test('runApplication asks for a required value, executes it, recaptures and checkpoints', async () => {
  const current = state();
  const input = { id: 'control:income', type: 'ui_control', name: 'Income', structural: { controlType: 'text' }, semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Income?' }, links: [] };
  current.entityGraph.entities.push(input);
  let iteration = 0;
  const seen = [];

  const result = await runApplication({
    state: current,
    page: {},
    query: 'q',
    gateway: {},
    requestInput: async (question) => { seen.push(['question', question.entityId]); return '1250'; },
    checkpoint: async () => seen.push(['checkpoint']),
    maxSteps: 3,
    deps: {
      captureVisibleDom: async () => snapshot(),
      enrichEntitySemantics: async () => ({ called: false }),
      selectReusableInput: () => null,
      selectNextRequiredInput: () => iteration++ === 0 ? input : null,
      buildInputQuestion: () => ({ entityId: input.id, label: 'Income?' }),
      applyInputValue: async ({ value }) => seen.push(['apply', value]),
      pageIdForSnapshot: () => 'page:a',
      refreshCurrentPage: () => seen.push(['refresh']),
      selectNavigationCandidates: () => [],
      workflowComplete: () => iteration > 1
    }
  });

  assert.equal(result.reason, 'completed');
  assert.deepEqual(seen, [
    ['question', 'control:income'],
    ['apply', '1250'],
    ['refresh'],
    ['checkpoint'],
    ['checkpoint']
  ]);
});

test('runApplication treats a changed page after continuation as a new workflow visit', async () => {
  const current = state('page:a');
  const next = { id: 'control:next', type: 'ui_control', name: 'Next', structural: { controlType: 'button' }, semantic: { interaction: 'navigation', relevantToGoal: true }, links: [] };
  let navigationDone = false;
  const visits = [];

  const result = await runApplication({
    state: current,
    page: {},
    query: 'q',
    gateway: {},
    checkpoint: async () => {},
    maxSteps: 3,
    deps: {
      captureVisibleDom: async () => snapshot('https://example.test/b', 'B'),
      enrichEntitySemantics: async () => ({ called: false }),
      selectReusableInput: () => null,
      selectNextRequiredInput: () => null,
      selectNavigationCandidates: () => navigationDone ? [] : [next],
      chooseNavigationCandidate: async () => next,
      executeContinuation: async () => { navigationDone = true; },
      pageIdForSnapshot: (s) => s.url.endsWith('/a') ? 'page:a' : 'page:b',
      ingestPageVisit: (_state, _snapshot, options) => { visits.push(options); current.contextStack = createContextStack(createFrame({ kind: 'page', contextEntityId: 'page:b', pageEntityId: 'page:b', visibleEntityIds: [] })); },
      refreshCurrentPage: () => { throw new Error('refresh should not be used after navigation'); },
      workflowComplete: () => navigationDone
    }
  });

  assert.equal(result.reason, 'completed');
  assert.equal(visits.length, 1);
  assert.equal(visits[0].enteredViaLinkEntityId, 'control:next');
});

test('runApplication stops at maxSteps when work keeps continuing', async () => {
  const current = state('page:a');
  const next = { id: 'control:next', type: 'ui_control', name: 'Next', structural: { controlType: 'button' }, semantic: { interaction: 'navigation', relevantToGoal: true }, links: [] };
  let clicks = 0;

  const result = await runApplication({
    state: current,
    page: {},
    query: 'q',
    gateway: {},
    checkpoint: async () => {},
    maxSteps: 2,
    deps: {
      captureVisibleDom: async () => snapshot(),
      enrichEntitySemantics: async () => ({ called: false }),
      selectReusableInput: () => null,
      selectNextRequiredInput: () => null,
      selectNavigationCandidates: () => [next],
      chooseNavigationCandidate: async () => next,
      executeContinuation: async () => { clicks += 1; },
      pageIdForSnapshot: () => 'page:a',
      refreshCurrentPage: () => {},
      workflowComplete: () => false
    }
  });

  assert.equal(result.reason, 'max_steps');
  assert.equal(clicks, 2);
});

test('runApplication logs semantic and navigation decisions without runtime values', async () => {
  const current = state('page:a');
  const next = { id: 'control:next', type: 'ui_control', name: 'Next', structural: { controlType: 'button' }, semantic: {}, links: [] };
  const events = [];
  const logger = { log: async (type, data) => events.push([type, data]) };

  const result = await runApplication({
    state: current,
    page: {},
    query: 'q',
    gateway: {},
    logger,
    deps: {
      enrichEntitySemantics: async () => ({ called: true, updatedEntityIds: [] }),
      selectReusableInput: () => null,
      selectNextRequiredInput: () => null,
      selectNavigationCandidates: () => [next],
      chooseNavigationCandidate: async () => null
    }
  });

  assert.equal(result.reason, 'blocked');
  assert.equal(events.some(([type]) => type === 'semantic.enrichment'), true);
  assert.equal(events.some(([type]) => type === 'navigation.candidates'), true);
  assert.equal(events.some(([type]) => type === 'navigation.blocked'), true);
  assert.equal(JSON.stringify(events).includes('value'), false);
});

test('persistent run state loads graphs/workflow and checkpoints all three stores', async () => {
  const loaded = { entityGraph: createEntityGraph(), instanceGraph: createInstanceGraph(), workflow: createWorkflow({ id: 'wf:x', originalQuestion: 'q' }) };
  const loads = [];
  const current = await loadPersistentRunState({
    workflowId: 'wf:x',
    query: 'q',
    config: { storage: { entityGraphPath: 'entities.json', instanceGraphPath: 'instances.json', workflowLogPath: 'workflows' } },
    stores: {
      loadEntityGraph: async (file) => { loads.push(file); return loaded.entityGraph; },
      loadInstanceGraph: async (file) => { loads.push(file); return loaded.instanceGraph; },
      loadWorkflow: async (dir, id) => { loads.push(`${dir}:${id}`); return loaded.workflow; }
    }
  });

  assert.equal(current.workflow.id, 'wf:x');
  assert.equal(current.contextStack, null);
  assert.deepEqual(loads, ['entities.json', 'instances.json', 'workflows:wf:x']);

  const saves = [];
  await checkpointRunState(current, {
    storage: { entityGraphPath: 'entities.json', instanceGraphPath: 'instances.json', workflowLogPath: 'workflows' }
  }, {
    saveEntityGraph: async (file) => saves.push(file),
    saveInstanceGraph: async (file) => saves.push(file),
    saveWorkflow: async (dir, workflow) => saves.push(`${dir}:${workflow.id}`)
  });
  assert.deepEqual(saves, ['entities.json', 'instances.json', 'workflows:wf:x']);
});
