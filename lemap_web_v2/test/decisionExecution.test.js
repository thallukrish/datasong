import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstanceGraph, findInstance, upsertInstance } from '../src/graph/instanceGraph.js';
import { createFrame, createContextStack, activeContext } from '../src/orchestrator/contextStack.js';
import {
  applyInputValue,
  applyReusableInput,
  executeContinuation
} from '../src/agent/decisionExecution.js';

function control(id, controlType, name = id) {
  return {
    id,
    type: 'ui_control',
    name,
    structural: { controlType, label: name },
    semantic: {},
    links: []
  };
}

function stateFor(entities) {
  const frame = createFrame({
    id: 'frame:1',
    kind: 'page',
    contextEntityId: 'page:1',
    pageEntityId: 'page:1',
    visibleEntityIds: entities.map((entity) => entity.id)
  });
  return {
    entityGraph: { version: 1, entities },
    instanceGraph: createInstanceGraph(),
    contextStack: createContextStack(frame)
  };
}

function recorder() {
  const calls = [];
  return {
    calls,
    executeAction: async (request) => {
      calls.push(request);
      return { instancePatch: null };
    }
  };
}

test('applyInputValue fills text controls, stores the logical value, and marks it applied', async () => {
  const field = control('field:name', 'text', 'Name');
  const state = stateFor([field]);
  const recorded = recorder();

  await applyInputValue({ state, page: {}, entity: field, value: 'Alice', executeAction: recorded.executeAction });

  assert.equal(recorded.calls.length, 1);
  assert.deepEqual(recorded.calls[0].action, { type: 'fill', value: 'Alice' });
  assert.equal(recorded.calls[0].entity.id, field.id);
  assert.deepEqual(findInstance(state.instanceGraph, field.id), { entityId: field.id, value: 'Alice' });
  assert.deepEqual(activeContext(state.contextStack).appliedEntityIds, [field.id]);
});

test('applyInputValue uses select for select controls', async () => {
  const field = control('field:status', 'select', 'Status');
  const state = stateFor([field]);
  const recorded = recorder();

  await applyInputValue({ state, page: {}, entity: field, value: 'active', executeAction: recorded.executeAction });

  assert.deepEqual(recorded.calls[0].action, { type: 'select', value: 'active' });
});

test('a logical radio group resolves the selected label to the concrete member control', async () => {
  const yes = control('radio:yes', 'radio', 'Yes');
  const no = control('radio:no', 'radio', 'No');
  const group = {
    id: 'group:filing',
    type: 'ui_group',
    name: 'Filing status',
    structural: { controlType: 'radio', cardinality: 'exactlyOne', memberIds: [yes.id, no.id] },
    semantic: {},
    links: []
  };
  const state = stateFor([group, yes, no]);
  const recorded = recorder();

  const result = await applyInputValue({ state, page: {}, entity: group, value: 'No', executeAction: recorded.executeAction });

  assert.deepEqual(result.targetEntityIds, [no.id]);
  assert.equal(recorded.calls[0].entity.id, no.id);
  assert.deepEqual(recorded.calls[0].action, { type: 'check', value: true });
  assert.deepEqual(findInstance(state.instanceGraph, group.id), { entityId: group.id, value: 'No' });
  assert.equal(findInstance(state.instanceGraph, no.id), null);
});

test('a multi-choice checkbox group applies every selected member but stores one logical group value', async () => {
  const email = control('check:email', 'checkbox', 'Email');
  const sms = control('check:sms', 'checkbox', 'SMS');
  const group = {
    id: 'group:channels',
    type: 'ui_group',
    name: 'Channels',
    structural: { controlType: 'checkbox', cardinality: 'zeroOrMore', memberIds: [email.id, sms.id] },
    semantic: {},
    links: []
  };
  const state = stateFor([group, email, sms]);
  const recorded = recorder();

  await applyInputValue({ state, page: {}, entity: group, value: ['Email', 'SMS'], executeAction: recorded.executeAction });

  assert.deepEqual(recorded.calls.map((call) => call.entity.id), [email.id, sms.id]);
  assert.ok(recorded.calls.every((call) => call.action.type === 'check' && call.action.value === true));
  assert.deepEqual(findInstance(state.instanceGraph, group.id), { entityId: group.id, value: ['Email', 'SMS'] });
});

test('applyReusableInput replays a stored instance value through the same execution path', async () => {
  const field = control('field:city', 'text', 'City');
  const state = stateFor([field]);
  upsertInstance(state.instanceGraph, { entityId: field.id, value: 'Bengaluru' });
  const recorded = recorder();

  await applyReusableInput({
    state,
    page: {},
    reusable: { entity: field, instance: findInstance(state.instanceGraph, field.id) },
    executeAction: recorded.executeAction
  });

  assert.deepEqual(recorded.calls[0].action, { type: 'fill', value: 'Bengaluru' });
  assert.deepEqual(activeContext(state.contextStack).appliedEntityIds, [field.id]);
});

test('executeContinuation clicks the chosen action and marks it applied without creating an instance value', async () => {
  const next = control('button:next', 'button', 'Next');
  const state = stateFor([next]);
  const recorded = recorder();

  await executeContinuation({ state, page: {}, entity: next, executeAction: recorded.executeAction });

  assert.deepEqual(recorded.calls[0].action, { type: 'click' });
  assert.equal(findInstance(state.instanceGraph, next.id), null);
  assert.deepEqual(activeContext(state.contextStack).appliedEntityIds, [next.id]);
});

test('invalid group choices fail before browser execution or instance mutation', async () => {
  const yes = control('radio:yes', 'radio', 'Yes');
  const group = {
    id: 'group:answer',
    type: 'ui_group',
    name: 'Answer',
    structural: { controlType: 'radio', cardinality: 'exactlyOne', memberIds: [yes.id] },
    semantic: {},
    links: []
  };
  const state = stateFor([group, yes]);
  const recorded = recorder();

  await assert.rejects(() => applyInputValue({
    state,
    page: {},
    entity: group,
    value: 'Maybe',
    executeAction: recorded.executeAction
  }), /choice/i);

  assert.equal(recorded.calls.length, 0);
  assert.equal(findInstance(state.instanceGraph, group.id), null);
});
