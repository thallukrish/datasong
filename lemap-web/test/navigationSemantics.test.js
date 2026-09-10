import test from 'node:test';
import assert from 'node:assert/strict';
import { selectWorkflowContinuation } from '../src/agent/entityFlow.js';

function control(id, name, role, priority, options = {}) {
  return {
    id,
    name,
    type: 'ui_control',
    structural: { controlType: options.controlType || 'button', visible: true, disabled: false },
    semantic: {
      interaction: options.interaction || 'navigation',
      relevantToGoal: options.relevantToGoal ?? true,
      required: options.required ?? false,
      workflowRole: role,
      navigationPriority: priority,
      consequence: options.consequence || 'reversible'
    },
    links: []
  };
}

test('navigation priority is authoritative among forward continuations', () => {
  const breadcrumbLookingButton = control('a', 'Filing Returns', 'continue', 15, { required: true });
  const plainLink = control('b', 'Open next filing step', 'continue', 95, { controlType: 'link' });
  assert.equal(selectWorkflowContinuation([breadcrumbLookingButton, plainLink])?.id, 'b');
});

test('back branch global exit and commit roles are never automatic forward progress', () => {
  const entities = [
    control('back', 'Back', 'back', 100),
    control('branch', 'Alternate route', 'branch', 100),
    control('global', 'Dashboard', 'global', 100),
    control('exit', 'Exit', 'exit', 100),
    control('commit', 'Submit', 'commit', 100, { consequence: 'commit' }),
    control('forward', 'Continue', 'continue', 60)
  ];
  assert.equal(selectWorkflowContinuation(entities)?.id, 'forward');
});

test('plain intermediate progress controls survive mistaken commit consequence classification', () => {
  const continueButton = control('continue', 'Continue', 'continue', 100, { consequence: 'commit', required: true });
  const submitButton = control('submit', 'Submit Return', 'continue', 100, { consequence: 'commit', required: true });

  assert.equal(selectWorkflowContinuation([continueButton, submitButton])?.id, 'continue');
  assert.equal(selectWorkflowContinuation([submitButton]), null);
});

test('missing navigation priority does not outrank explicit semantic ranking', () => {
  const oldSemantic = control('old', 'Old Continue', 'continue', undefined, { required: true });
  delete oldSemantic.semantic.navigationPriority;
  const ranked = control('ranked', 'Ranked Continue', 'continue', 70);
  assert.equal(selectWorkflowContinuation([oldSemantic, ranked])?.id, 'ranked');
});
