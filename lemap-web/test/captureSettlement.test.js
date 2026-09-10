import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSignature, waitForStructuralCaptureChange } from '../src/agent/captureSettlement.js';

function capture(pageId, entities) {
  return { pageId, entities };
}

const before = capture('page:itr3', [
  { id: 'page:itr3', type: 'page', structural: {} },
  { id: 'button:start', type: 'ui_control', structural: { visible: true, disabled: false, controlType: 'button' } }
]);

test('capture signature changes when a same-page action reveals new controls', () => {
  const after = capture('page:itr3', [
    ...before.entities,
    { id: 'group:filing-section', type: 'group', structural: { visible: true, cardinality: 'exactlyOne', values: ['A', 'B'] } },
    { id: 'field:sub-condition', type: 'ui_control', structural: { visible: true, controlType: 'checkbox', checked: false } }
  ]);
  assert.notEqual(captureSignature(before), captureSignature(after));
});

test('waits through an early unchanged capture and returns the later structural state', async () => {
  const changed = capture('page:itr3', [
    ...before.entities,
    { id: 'field:radio-a', type: 'ui_control', structural: { visible: true, controlType: 'radio', checked: false } },
    { id: 'field:checkbox-a', type: 'ui_control', structural: { visible: true, controlType: 'checkbox', checked: false } }
  ]);
  const captures = [before, before, changed];
  let reads = 0;
  const result = await waitForStructuralCaptureChange({
    before,
    capture: async () => captures[Math.min(reads++, captures.length - 1)],
    wait: async () => {},
    timeoutMs: 1000,
    pollMs: 10
  });
  assert.equal(result.changed, true);
  assert.equal(result.capture, changed);
  assert.equal(reads, 3);
});

test('returns the latest capture after timeout when nothing structurally changes', async () => {
  let now = 0;
  const result = await waitForStructuralCaptureChange({
    before,
    capture: async () => before,
    wait: async (ms) => { now += ms; },
    now: () => now,
    timeoutMs: 30,
    pollMs: 10
  });
  assert.equal(result.changed, false);
  assert.equal(result.capture, before);
});
