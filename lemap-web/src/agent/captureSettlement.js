import { activeContext, createContextStack, reconcileContextStack } from './contextStack.js';

function arr(value) { return Array.isArray(value) ? value : []; }

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

const STACK = Symbol.for('lemap.web.contextStack');

function stackFor(before) {
  return before?.[STACK] || createContextStack(before);
}

function attachStack(capture, stack) {
  if (!capture || typeof capture !== 'object') return capture;
  Object.defineProperty(capture, STACK, { value: stack, enumerable: false, configurable: true });
  return capture;
}

function settleContext(before, latest) {
  const stack = stackFor(before);
  const contextChange = reconcileContextStack(stack, latest);
  const active = activeContext(stack);
  attachStack(active.capture, stack);
  return { capture: active.capture, contextChange, contextDepth: stack.frames.length };
}

export function captureSignature(capture = {}) {
  const entities = arr(capture.entities)
    .map((entity) => ({
      id: String(entity.id || ''),
      type: String(entity.type || ''),
      structural: stableValue({
        visible: entity.structural?.visible,
        disabled: entity.structural?.disabled,
        controlType: entity.structural?.controlType,
        cardinality: entity.structural?.cardinality,
        values: entity.structural?.values,
        checked: entity.structural?.checked,
        value: entity.structural?.value
      })
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ pageId: String(capture.pageId || ''), entities });
}

export async function waitForStructuralCaptureChange({
  before,
  capture,
  wait,
  now = () => Date.now(),
  timeoutMs = 10000,
  pollMs = 150
} = {}) {
  const baseline = captureSignature(before);
  const startedAt = now();
  let latest = before;

  while (now() - startedAt <= timeoutMs) {
    latest = await capture();
    const waitedMs = Math.max(0, now() - startedAt);
    if (captureSignature(latest) !== baseline) {
      return { ...settleContext(before, latest), changed: true, waitedMs };
    }
    if (waitedMs >= timeoutMs) break;
    await wait(Math.min(pollMs, timeoutMs - waitedMs));
  }

  const settled = settleContext(before, latest);
  return { ...settled, changed: false, waitedMs: Math.max(0, now() - startedAt) };
}
