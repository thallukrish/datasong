import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOverlayPlan } from '../src/semantic/overlayPlanner.js';
import { normalizeOverlaySnapshot } from '../src/agent/blockingOverlay.js';

test('blocking overlay snapshot keeps only visible modal actions', () => {
  const overlay = normalizeOverlaySnapshot({
    title: 'Confirmation',
    text: 'Please ensure prerequisite is approved before continuing.',
    actions: [
      { label: 'Cancel', visible: true, disabled: false, domId: 'cancel' },
      { label: 'Continue', visible: true, disabled: false, domId: 'continue' },
      { label: 'Hidden', visible: false, disabled: false }
    ]
  });
  assert.equal(overlay.actions.length, 2);
  assert.deepEqual(overlay.actions.map((item) => item.label), ['Cancel', 'Continue']);
  assert.ok(overlay.actions.every((item) => item.id.startsWith('overlay-action:')));
});

test('overlay planner can ask user when modal exposes a prerequisite', () => {
  const actions = [
    { id: 'overlay-action:0', label: 'Cancel' },
    { id: 'overlay-action:1', label: 'Continue' }
  ];
  const plan = normalizeOverlayPlan({
    decision: 'ask_user',
    question: 'Has the prerequisite already been approved?',
    confidence: 0.96,
    reason: 'Continuing would assume a user-specific prerequisite.'
  }, actions);
  assert.equal(plan.decision, 'ask_user');
  assert.equal(plan.actionId, '');
  assert.match(plan.question, /approved/i);
});

test('overlay planner accepts only supplied modal actions', () => {
  const actions = [
    { id: 'overlay-action:0', label: 'Cancel' },
    { id: 'overlay-action:1', label: 'Continue' }
  ];
  const invalid = normalizeOverlayPlan({ decision: 'act', actionId: 'made-up', confidence: 1 }, actions);
  assert.equal(invalid.decision, 'stop');

  const valid = normalizeOverlayPlan({ decision: 'act', actionId: 'overlay-action:1', confidence: 0.9, reason: 'Informational acknowledgement.' }, actions);
  assert.equal(valid.decision, 'act');
  assert.equal(valid.actionId, 'overlay-action:1');
});
