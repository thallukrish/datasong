import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createContextStack,
  createFrame,
  activeContext,
  pushContext,
  popContext,
  updateActiveContext,
  actionableEntityIds
} from '../src/orchestrator/contextStack.js';

test('createContextStack starts with a page frame as the active context', () => {
  const frame = createFrame({
    kind: 'page',
    contextEntityId: 'page:1',
    pageEntityId: 'page:1',
    visibleEntityIds: ['page:1', 'section:1']
  });
  const stack = createContextStack(frame);

  assert.equal(stack.frames.length, 1);
  assert.equal(activeContext(stack).contextEntityId, 'page:1');
  assert.deepEqual(actionableEntityIds(stack), ['page:1', 'section:1']);
});

test('pushing a modal makes only the modal frame active while retaining the parent frame', () => {
  const stack = createContextStack(createFrame({
    kind: 'page',
    contextEntityId: 'page:1',
    pageEntityId: 'page:1',
    visibleEntityIds: ['page:1', 'open-dialog']
  }));

  const modal = pushContext(stack, {
    kind: 'modal',
    contextEntityId: 'modal:1',
    visibleEntityIds: ['modal:1', 'modal-field:1']
  });

  assert.equal(stack.frames.length, 2);
  assert.equal(modal.pageEntityId, 'page:1');
  assert.equal(modal.parentFrameId, stack.frames[0].id);
  assert.equal(activeContext(stack).contextEntityId, 'modal:1');
  assert.deepEqual(actionableEntityIds(stack), ['modal:1', 'modal-field:1']);
});

test('popping a modal restores the parent frame state unchanged', () => {
  const root = createFrame({
    kind: 'page',
    contextEntityId: 'page:1',
    pageEntityId: 'page:1',
    visibleEntityIds: ['page:1', 'field:1'],
    appliedEntityIds: ['field:1'],
    activeDynamicBranchIds: ['section:conditional']
  });
  const stack = createContextStack(root);
  pushContext(stack, {
    kind: 'modal',
    contextEntityId: 'modal:1',
    visibleEntityIds: ['modal:1']
  });

  const popped = popContext(stack);

  assert.equal(popped.contextEntityId, 'modal:1');
  assert.equal(activeContext(stack).id, root.id);
  assert.deepEqual(activeContext(stack).appliedEntityIds, ['field:1']);
  assert.deepEqual(activeContext(stack).activeDynamicBranchIds, ['section:conditional']);
});

test('nested modal frames obey last-in first-out behavior', () => {
  const stack = createContextStack(createFrame({
    kind: 'page', contextEntityId: 'page:1', pageEntityId: 'page:1'
  }));
  pushContext(stack, { kind: 'modal', contextEntityId: 'modal:1' });
  pushContext(stack, { kind: 'modal', contextEntityId: 'modal:2' });

  assert.equal(activeContext(stack).contextEntityId, 'modal:2');
  popContext(stack);
  assert.equal(activeContext(stack).contextEntityId, 'modal:1');
  popContext(stack);
  assert.equal(activeContext(stack).contextEntityId, 'page:1');
});

test('updateActiveContext changes only the top frame and de-duplicates runtime ids', () => {
  const stack = createContextStack(createFrame({
    kind: 'page',
    contextEntityId: 'page:1',
    pageEntityId: 'page:1',
    visibleEntityIds: ['page:1']
  }));
  pushContext(stack, { kind: 'modal', contextEntityId: 'modal:1' });

  updateActiveContext(stack, {
    visibleEntityIds: ['modal:1', 'field:1', 'field:1'],
    appliedEntityIds: ['field:1', 'field:1'],
    activeDynamicBranchIds: ['branch:1', 'branch:1']
  });

  assert.deepEqual(activeContext(stack).visibleEntityIds, ['modal:1', 'field:1']);
  assert.deepEqual(activeContext(stack).appliedEntityIds, ['field:1']);
  assert.deepEqual(activeContext(stack).activeDynamicBranchIds, ['branch:1']);
  assert.deepEqual(stack.frames[0].visibleEntityIds, ['page:1']);
});

test('the root page frame cannot be popped', () => {
  const stack = createContextStack(createFrame({
    kind: 'page', contextEntityId: 'page:1', pageEntityId: 'page:1'
  }));

  assert.throws(() => popContext(stack), /root context/);
});
