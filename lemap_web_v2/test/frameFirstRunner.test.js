import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityGraph } from '../src/graph/entityGraph.js';
import { createInstanceGraph } from '../src/graph/instanceGraph.js';
import { createWorkflow, appendWorkflowStep } from '../src/workflow/workflowTraversal.js';
import { createFrame, createContextStack, activeContext, pushContext, popContext } from '../src/orchestrator/contextStack.js';
import { runApplication, filterWorkflowNavigationCandidates } from '../src/app/applicationRunner.js';

function input(id) {
  return { id, type: 'ui_control', name: id, structural: { controlType: 'text' }, semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: id }, links: [] };
}

function button(id) {
  return { id, type: 'ui_control', name: id, structural: { controlType: 'button' }, semantic: { interaction: 'navigation', relevantToGoal: true }, links: [] };
}

function state(entities, visibleIds = entities.map((entity) => entity.id)) {
  const frame = createFrame({ kind: 'page', contextEntityId: 'page:a', pageEntityId: 'page:a', visibleEntityIds: visibleIds });
  return {
    entityGraph: createEntityGraph({ entities }),
    instanceGraph: createInstanceGraph(),
    workflow: createWorkflow({ id: 'wf:1', originalQuestion: 'q' }),
    contextStack: createContextStack(frame)
  };
}

test('required inputs on one page do not consume workflow maxSteps', async () => {
  const a = input('field:a');
  const b = input('field:b');
  const current = state([a, b]);
  const remaining = [a, b];
  const applied = [];

  const result = await runApplication({
    state: current,
    page: {},
    gateway: {},
    requestInput: async ({ entityId }) => entityId,
    maxSteps: 1,
    deps: {
      enrichEntitySemantics: async () => ({ called: false }),
      selectReusableInput: () => null,
      selectNextRequiredInput: () => remaining.shift() || null,
      buildInputQuestion: (entity) => ({ entityId: entity.id, label: entity.id }),
      applyInputValue: async ({ entity }) => applied.push(entity.id),
      captureVisibleDom: async () => ({ url: 'https://example.test/a' }),
      pageIdForSnapshot: () => 'page:a',
      refreshCurrentPage: () => ({}),
      selectNavigationCandidates: () => [],
      workflowComplete: () => true
    }
  });

  assert.equal(result.reason, 'completed');
  assert.equal(result.steps, 0);
  assert.deepEqual(applied, ['field:a', 'field:b']);
});

test('a revealed child frame is resolved before returning to parent navigation', async () => {
  const parentInput = input('field:parent');
  const childInput = input('field:child');
  const next = button('next');
  const current = state([parentInput, childInput, next], ['field:parent', 'next']);
  const order = [];
  let parentDone = false;
  let childDone = false;
  let navigated = false;

  const result = await runApplication({
    state: current,
    page: {},
    gateway: {},
    requestInput: async ({ entityId }) => entityId,
    maxSteps: 1,
    deps: {
      enrichEntitySemantics: async () => ({ called: false }),
      selectReusableInput: () => null,
      selectNextRequiredInput: ({ visibleEntityIds }) => {
        if (visibleEntityIds.includes('field:child') && !childDone) return childInput;
        if (visibleEntityIds.includes('field:parent') && !parentDone) return parentInput;
        return null;
      },
      buildInputQuestion: (entity) => ({ entityId: entity.id, label: entity.id }),
      applyInputValue: async ({ entity }) => {
        order.push(`input:${entity.id}`);
        if (entity.id === parentInput.id) parentDone = true;
        if (entity.id === childInput.id) childDone = true;
      },
      captureVisibleDom: async () => ({ url: 'https://example.test/a' }),
      pageIdForSnapshot: () => 'page:a',
      refreshCurrentPage: () => {
        if (parentDone && current.contextStack.frames.length === 1 && !childDone) {
          pushContext(current.contextStack, { kind: 'dynamic', contextEntityId: 'section:child', visibleEntityIds: ['field:child'], activeDynamicBranchIds: ['section:child'] });
        }
        return {};
      },
      completeActiveFrame: () => popContext(current.contextStack),
      selectNavigationCandidates: (_entities, { visibleEntityIds }) => (
        visibleEntityIds.includes('next') && !navigated ? [next] : []
      ),
      chooseNavigationCandidate: async ({ candidates }) => candidates[0] || null,
      executeContinuation: async () => { order.push('navigate:next'); navigated = true; },
      workflowComplete: () => navigated
    }
  });

  assert.equal(result.reason, 'max_steps');
  assert.deepEqual(order, ['input:field:parent', 'input:field:child', 'navigate:next']);
  assert.equal(activeContext(current.contextStack).kind, 'page');
});

test('workflow navigation removes global links, explicit back links and known destinations already visited', () => {
  const next = button('next');
  next.links.push({ id: 'page:new', relationship: 'transitionsTo' });

  const previous = button('previous');
  previous.links.push({ id: 'page:old', relationship: 'transitionsTo' });

  const back = button('back');
  back.semantic.workflowRole = 'back';

  const global = button('home');
  global.structural.siteChrome = true;

  const current = state([next, previous, back, global]);
  appendWorkflowStep(current.workflow, { pageEntityId: 'page:old' });
  appendWorkflowStep(current.workflow, { pageEntityId: 'page:a' });

  assert.deepEqual(
    filterWorkflowNavigationCandidates([next, previous, back, global], current).map((entity) => entity.id),
    ['next']
  );
});
