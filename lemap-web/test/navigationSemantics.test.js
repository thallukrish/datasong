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

test('selected forward continuation is chosen by semantic priority', () => {
  const lower = control('a', 'Candidate A', 'continue', 15, { required: true });
  const higher = control('b', 'Candidate B', 'continue', 100, { controlType: 'link' });
  assert.equal(selectWorkflowContinuation([lower, higher])?.id, 'b');
});

test('non-forward or non-reversible actions are never automatic continuations', () => {
  const entities = [
    control('back', 'Candidate A', 'back', 100),
    control('branch', 'Candidate B', 'branch', 100),
    control('global', 'Candidate C', 'global', 100),
    control('exit', 'Candidate D', 'exit', 100),
    control('commit', 'Candidate E', 'commit', 100, { consequence: 'commit' }),
    control('unsafe-forward', 'Candidate F', 'continue', 100, { consequence: 'commit' }),
    control('forward', 'Candidate G', 'continue', 60)
  ];
  assert.equal(selectWorkflowContinuation(entities)?.id, 'forward');
});

test('labels do not override navigation semantics', () => {
  const misleading = control('misleading', 'Arbitrary label', 'continue', 100, { consequence: 'commit' });
  assert.equal(selectWorkflowContinuation([misleading]), null);
});

test('missing navigation priority does not outrank explicit semantic ranking', () => {
  const unranked = control('old', 'Candidate A', 'continue', undefined, { required: true });
  delete unranked.semantic.navigationPriority;
  const ranked = control('ranked', 'Candidate B', 'continue', 70);
  assert.equal(selectWorkflowContinuation([unranked, ranked])?.id, 'ranked');
});
