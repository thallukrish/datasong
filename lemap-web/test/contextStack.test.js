import test from 'node:test';
import assert from 'node:assert/strict';
import { activeContext, createContextStack, reconcileContextStack } from '../src/agent/contextStack.js';
import { waitForStructuralCaptureChange } from '../src/agent/captureSettlement.js';

function capture(pageId, type = 'page') {
  return {
    pageId,
    entities: [{ id: pageId, type, structural: type === 'modal' ? { overlay: true } : {} }]
  };
}

test('opening and closing a modal pushes then pops back to the preserved page frame', () => {
  const stack = createContextStack(capture('page:a'));
  assert.equal(reconcileContextStack(stack, capture('modal:m1', 'modal')).type, 'push');
  assert.deepEqual(stack.frames.map((frame) => [frame.capture.pageId, frame.kind]), [
    ['page:a', 'page'],
    ['modal:m1', 'modal']
  ]);
  assert.equal(reconcileContextStack(stack, capture('page:a')).type, 'pop');
  assert.equal(stack.frames.length, 1);
  assert.equal(activeContext(stack).capture.pageId, 'page:a');
});

test('nested modal pushes and closing it reveals the previous modal frame', () => {
  const stack = createContextStack(capture('page:a'));
  reconcileContextStack(stack, capture('modal:m1', 'modal'));
  reconcileContextStack(stack, capture('modal:m2', 'modal'));
  assert.equal(stack.frames.length, 3);
  assert.equal(reconcileContextStack(stack, capture('modal:m1', 'modal')).type, 'pop');
  assert.equal(stack.frames.length, 2);
  assert.equal(activeContext(stack).capture.pageId, 'modal:m1');
});

test('same modal recapture updates the top frame rather than pushing a duplicate', () => {
  const stack = createContextStack(capture('page:a'));
  reconcileContextStack(stack, capture('modal:m1', 'modal'));
  const changed = capture('modal:m1', 'modal');
  changed.marker = 'changed';
  assert.equal(reconcileContextStack(stack, changed).type, 'update');
  assert.equal(stack.frames.length, 2);
  assert.equal(activeContext(stack).capture.marker, 'changed');
});

test('navigation from a modal to a genuinely new page unwinds the modal stack', () => {
  const stack = createContextStack(capture('page:a'));
  reconcileContextStack(stack, capture('modal:m1', 'modal'));
  assert.equal(reconcileContextStack(stack, capture('page:b')).type, 'navigate');
  assert.equal(stack.frames.length, 1);
  assert.equal(activeContext(stack).capture.pageId, 'page:b');
});

test('capture settlement carries the stack across modal push and pop', async () => {
  const base = capture('page:a');
  const modal = capture('modal:m1', 'modal');
  const pushed = await waitForStructuralCaptureChange({
    before: base,
    capture: async () => modal,
    wait: async () => {},
    timeoutMs: 1,
    pollMs: 1
  });
  assert.equal(pushed.contextChange.type, 'push');
  assert.equal(pushed.contextDepth, 2);

  const popped = await waitForStructuralCaptureChange({
    before: pushed.capture,
    capture: async () => base,
    wait: async () => {},
    timeoutMs: 1,
    pollMs: 1
  });
  assert.equal(popped.contextChange.type, 'pop');
  assert.equal(popped.contextDepth, 1);
  assert.equal(popped.capture.pageId, 'page:a');
});
