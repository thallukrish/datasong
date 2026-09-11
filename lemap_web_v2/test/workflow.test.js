import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkflow,
  appendWorkflowStep,
  currentWorkflowStep,
  previousWorkflowStep,
  nextWorkflowStep,
  moveWorkflowCursor
} from '../src/workflow/workflowTraversal.js';

test('createWorkflow preserves the original user question and starts empty', () => {
  const workflow = createWorkflow({
    id: 'workflow:1',
    originalQuestion: 'Where do I enter foreign income?'
  });

  assert.equal(workflow.id, 'workflow:1');
  assert.equal(workflow.originalQuestion, 'Where do I enter foreign income?');
  assert.deepEqual(workflow.steps, []);
  assert.equal(workflow.cursor, -1);
});

test('appendWorkflowStep records ordered traversal without duplicating shared page entities', () => {
  const workflow = createWorkflow({ id: 'workflow:1', originalQuestion: 'Find filing status' });

  appendWorkflowStep(workflow, { pageEntityId: 'page:A' });
  appendWorkflowStep(workflow, { pageEntityId: 'page:B', enteredViaLinkEntityId: 'link:AB' });
  appendWorkflowStep(workflow, { pageEntityId: 'page:A', enteredViaLinkEntityId: 'link:BA' });

  assert.deepEqual(workflow.steps.map((step) => step.sequence), [1, 2, 3]);
  assert.deepEqual(workflow.steps.map((step) => step.pageEntityId), ['page:A', 'page:B', 'page:A']);
  assert.equal(workflow.steps[2].enteredViaLinkEntityId, 'link:BA');
  assert.equal(workflow.cursor, 2);
});

test('workflow navigation is relative to traversal steps rather than persistent page links', () => {
  const workflow = createWorkflow({ id: 'workflow:1', originalQuestion: 'Navigate' });
  appendWorkflowStep(workflow, { pageEntityId: 'page:A' });
  appendWorkflowStep(workflow, { pageEntityId: 'page:B', enteredViaLinkEntityId: 'link:AB' });
  appendWorkflowStep(workflow, { pageEntityId: 'page:A', enteredViaLinkEntityId: 'link:BA' });

  assert.equal(currentWorkflowStep(workflow).sequence, 3);
  assert.equal(previousWorkflowStep(workflow).sequence, 2);
  assert.equal(nextWorkflowStep(workflow), null);

  moveWorkflowCursor(workflow, 1);
  assert.equal(currentWorkflowStep(workflow).pageEntityId, 'page:B');
  assert.equal(previousWorkflowStep(workflow).pageEntityId, 'page:A');
  assert.equal(nextWorkflowStep(workflow).pageEntityId, 'page:A');
});

test('appendWorkflowStep stores an optional runtime frame snapshot reference without embedding frame state', () => {
  const workflow = createWorkflow({ id: 'workflow:1', originalQuestion: 'Navigate' });

  const step = appendWorkflowStep(workflow, {
    pageEntityId: 'page:A',
    frameId: 'frame:7'
  });

  assert.equal(step.frameId, 'frame:7');
  assert.equal('visibleEntityIds' in step, false);
  assert.equal('appliedEntityIds' in step, false);
});

test('moveWorkflowCursor rejects positions outside the recorded traversal', () => {
  const workflow = createWorkflow({ id: 'workflow:1', originalQuestion: 'Navigate' });
  appendWorkflowStep(workflow, { pageEntityId: 'page:A' });

  assert.throws(() => moveWorkflowCursor(workflow, -1), /cursor/i);
  assert.throws(() => moveWorkflowCursor(workflow, 1), /cursor/i);
});
