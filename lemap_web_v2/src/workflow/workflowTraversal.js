function assertWorkflow(workflow) {
  if (!workflow || !Array.isArray(workflow.steps)) {
    throw new Error('A workflow with steps is required.');
  }
}

export function createWorkflow({ id = '', originalQuestion = '' } = {}) {
  if (!id) throw new Error('workflow id is required.');
  return {
    id,
    originalQuestion,
    steps: [],
    cursor: -1
  };
}

export function appendWorkflowStep(workflow, {
  pageEntityId = '',
  enteredViaLinkEntityId,
  frameId
} = {}) {
  assertWorkflow(workflow);
  if (!pageEntityId) throw new Error('pageEntityId is required.');

  const step = {
    workflowId: workflow.id,
    sequence: workflow.steps.length + 1,
    pageEntityId
  };

  if (enteredViaLinkEntityId !== undefined) {
    step.enteredViaLinkEntityId = enteredViaLinkEntityId;
  }
  if (frameId !== undefined) {
    step.frameId = frameId;
  }

  workflow.steps.push(step);
  workflow.cursor = workflow.steps.length - 1;
  return step;
}

export function currentWorkflowStep(workflow) {
  assertWorkflow(workflow);
  if (workflow.cursor < 0 || workflow.cursor >= workflow.steps.length) return null;
  return workflow.steps[workflow.cursor];
}

export function previousWorkflowStep(workflow) {
  assertWorkflow(workflow);
  const index = workflow.cursor - 1;
  return index >= 0 ? workflow.steps[index] : null;
}

export function nextWorkflowStep(workflow) {
  assertWorkflow(workflow);
  const index = workflow.cursor + 1;
  return index < workflow.steps.length ? workflow.steps[index] : null;
}

export function moveWorkflowCursor(workflow, cursor) {
  assertWorkflow(workflow);
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= workflow.steps.length) {
    throw new Error(`Invalid workflow cursor: ${cursor}`);
  }
  workflow.cursor = cursor;
  return currentWorkflowStep(workflow);
}
