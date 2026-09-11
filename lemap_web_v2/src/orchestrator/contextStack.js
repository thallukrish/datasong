import crypto from 'node:crypto';

const FRAME_KINDS = new Set(['page', 'modal', 'dynamic']);

function uniqueIds(values = []) {
  if (!Array.isArray(values)) throw new Error('Runtime entity ids must be arrays.');
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function newFrameId() {
  return `frame:${crypto.randomUUID()}`;
}

export function createFrame({
  kind = 'page',
  contextEntityId = '',
  pageEntityId = '',
  visibleEntityIds = [],
  appliedEntityIds = [],
  activeDynamicBranchIds = [],
  parentFrameId = null,
  id = ''
} = {}) {
  if (!FRAME_KINDS.has(kind)) throw new Error(`Unsupported frame kind: ${kind}`);
  if (!contextEntityId) throw new Error('contextEntityId is required.');
  if (kind === 'page' && !pageEntityId) throw new Error('pageEntityId is required for a page frame.');

  return {
    id: id || newFrameId(),
    kind,
    contextEntityId: String(contextEntityId),
    pageEntityId: pageEntityId ? String(pageEntityId) : '',
    visibleEntityIds: uniqueIds(visibleEntityIds),
    appliedEntityIds: uniqueIds(appliedEntityIds),
    activeDynamicBranchIds: uniqueIds(activeDynamicBranchIds),
    parentFrameId: parentFrameId ? String(parentFrameId) : null
  };
}

export function createContextStack(rootFrame) {
  if (!rootFrame?.id) throw new Error('A root frame is required.');
  if (rootFrame.kind !== 'page') throw new Error('The root context must be a page frame.');
  if (rootFrame.parentFrameId) throw new Error('The root context cannot have a parent frame.');

  return {
    version: 1,
    frames: [{
      ...rootFrame,
      visibleEntityIds: uniqueIds(rootFrame.visibleEntityIds),
      appliedEntityIds: uniqueIds(rootFrame.appliedEntityIds),
      activeDynamicBranchIds: uniqueIds(rootFrame.activeDynamicBranchIds)
    }]
  };
}

export function activeContext(stack) {
  if (!stack || !Array.isArray(stack.frames) || stack.frames.length === 0) {
    throw new Error('A non-empty context stack is required.');
  }
  return stack.frames[stack.frames.length - 1];
}

export function pushContext(stack, frameSpec = {}) {
  const parent = activeContext(stack);
  const frame = createFrame({
    ...frameSpec,
    pageEntityId: frameSpec.pageEntityId || parent.pageEntityId,
    parentFrameId: parent.id
  });
  stack.frames.push(frame);
  return frame;
}

export function popContext(stack) {
  activeContext(stack);
  if (stack.frames.length === 1) throw new Error('Cannot pop the root context.');
  return stack.frames.pop();
}

export function updateActiveContext(stack, patch = {}) {
  const frame = activeContext(stack);

  if (patch.visibleEntityIds !== undefined) {
    frame.visibleEntityIds = uniqueIds(patch.visibleEntityIds);
  }
  if (patch.appliedEntityIds !== undefined) {
    frame.appliedEntityIds = uniqueIds(patch.appliedEntityIds);
  }
  if (patch.activeDynamicBranchIds !== undefined) {
    frame.activeDynamicBranchIds = uniqueIds(patch.activeDynamicBranchIds);
  }

  return frame;
}

export function actionableEntityIds(stack) {
  return [...activeContext(stack).visibleEntityIds];
}
