import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRunState,
  ingestPageVisit,
  refreshCurrentPage
} from '../src/orchestrator/runCoordinator.js';

function snapshot(url, child = null) {
  return {
    version: 1,
    url,
    title: 'Test Page',
    root: {
      tag: 'body',
      directText: '',
      attributes: {},
      children: child ? [child] : []
    }
  };
}

function input(id, name = id) {
  return {
    tag: 'input',
    directText: '',
    attributes: { id, name, type: 'text' },
    children: []
  };
}

test('createRunState starts with separate persistent, runtime and traversal state', () => {
  const state = createRunState({ workflowId: 'workflow:1', originalQuestion: 'Find income' });

  assert.deepEqual(state.entityGraph, { version: 1, entities: [] });
  assert.deepEqual(state.instanceGraph, { version: 1, instances: [] });
  assert.equal(state.workflow.id, 'workflow:1');
  assert.equal(state.workflow.originalQuestion, 'Find income');
  assert.equal(state.contextStack, null);
});

test('ingestPageVisit learns one page, creates the page frame and appends one workflow step', () => {
  const state = createRunState({ workflowId: 'workflow:1', originalQuestion: 'Find income' });
  const result = ingestPageVisit(state, snapshot('https://example.test/form', input('income')));

  assert.equal(state.workflow.steps.length, 1);
  assert.equal(state.workflow.steps[0].pageEntityId, result.pageEntityId);
  assert.equal(state.contextStack.frames.length, 1);
  assert.equal(state.contextStack.frames[0].pageEntityId, result.pageEntityId);
  assert.equal(state.contextStack.frames[0].visibleEntityIds.includes(result.pageEntityId), true);
  assert.equal(state.entityGraph.entities.some((entity) => entity.structural?.domId === 'income'), true);
});

test('refreshCurrentPage enriches a known page without appending another workflow step', () => {
  const state = createRunState({ workflowId: 'workflow:1', originalQuestion: 'Find income' });
  ingestPageVisit(state, snapshot('https://example.test/form'));

  const refreshed = refreshCurrentPage(
    state,
    snapshot('https://example.test/form', input('income'))
  );

  assert.equal(state.workflow.steps.length, 1);
  assert.equal(refreshed.addedEntityIds.length > 0, true);
  assert.equal(state.contextStack.frames[0].visibleEntityIds.includes(refreshed.pageEntityId), true);
  assert.equal(state.entityGraph.entities.some((entity) => entity.structural?.domId === 'income'), true);
});

test('ingestPageVisit records a later navigation as another workflow step while reusing shared page knowledge', () => {
  const state = createRunState({ workflowId: 'workflow:1', originalQuestion: 'Navigate' });
  const first = ingestPageVisit(state, snapshot('https://example.test/a'));
  ingestPageVisit(state, snapshot('https://example.test/b'), { enteredViaLinkEntityId: 'link:ab' });
  const third = ingestPageVisit(state, snapshot('https://example.test/a'), { enteredViaLinkEntityId: 'link:ba' });

  assert.deepEqual(state.workflow.steps.map((step) => step.pageEntityId), [
    first.pageEntityId,
    state.workflow.steps[1].pageEntityId,
    first.pageEntityId
  ]);
  assert.equal(third.reusedPage, true);
  assert.equal(state.workflow.steps[2].enteredViaLinkEntityId, 'link:ba');
});

test('refreshCurrentPage records dynamic reveal causality without replacing the active page frame', () => {
  const state = createRunState({ workflowId: 'workflow:1', originalQuestion: 'Reveal reason' });
  const initial = ingestPageVisit(state, snapshot('https://example.test/form', input('status')));
  const trigger = state.entityGraph.entities.find((entity) => entity.structural?.domId === 'status');
  const frameId = state.contextStack.frames[0].id;

  const refreshed = refreshCurrentPage(
    state,
    snapshot('https://example.test/form', {
      tag: 'div',
      directText: '',
      attributes: { id: 'reason-section' },
      children: [input('reason')]
    }),
    { trigger: { entityId: trigger.id, condition: { value: 'N' } } }
  );

  assert.equal(state.contextStack.frames[0].id, frameId);
  assert.equal(refreshed.pageEntityId, initial.pageEntityId);
  const triggerAfter = state.entityGraph.entities.find((entity) => entity.id === trigger.id);
  assert.equal(triggerAfter.links.some((link) => link.relationship === 'dynamicChild'), true);
});
