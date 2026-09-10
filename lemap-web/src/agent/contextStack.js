function isModalCapture(capture = {}) {
  if (capture?.explored?.snapshot?.overlay?.active === true) return true;
  return Array.isArray(capture?.entities)
    && capture.entities.some((entity) => entity?.id === capture.pageId && entity?.type === 'modal');
}

function frameFor(capture) {
  return {
    kind: isModalCapture(capture) ? 'modal' : 'page',
    capture,
    appliedInstanceEntityIds: new Set()
  };
}

export function createContextStack(initialCapture) {
  return { frames: initialCapture ? [frameFor(initialCapture)] : [] };
}

export function activeContext(stack) {
  return stack?.frames?.at(-1) || null;
}

export function reconcileContextStack(stack, nextCapture) {
  if (!stack || !Array.isArray(stack.frames)) throw new Error('A context stack is required.');
  if (!nextCapture?.pageId) throw new Error('A capture with pageId is required.');

  const nextKind = isModalCapture(nextCapture) ? 'modal' : 'page';
  const existingIndex = stack.frames.findLastIndex(
    (frame) => frame.capture?.pageId === nextCapture.pageId && frame.kind === nextKind
  );

  if (existingIndex >= 0) {
    const wasTop = existingIndex === stack.frames.length - 1;
    stack.frames.length = existingIndex + 1;
    stack.frames[existingIndex].capture = nextCapture;
    return { type: wasTop ? 'update' : 'pop', active: stack.frames[existingIndex] };
  }

  if (nextKind === 'modal') {
    const frame = frameFor(nextCapture);
    stack.frames.push(frame);
    return { type: 'push', active: frame };
  }

  const frame = frameFor(nextCapture);
  stack.frames.splice(0, stack.frames.length, frame);
  return { type: 'navigate', active: frame };
}
