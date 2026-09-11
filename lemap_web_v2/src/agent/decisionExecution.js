import { executeControlAction } from '../execution/controlExecutor.js';
import { upsertInstance } from '../graph/instanceGraph.js';
import { activeContext, updateActiveContext } from '../orchestrator/contextStack.js';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function requireState(state) {
  if (!state?.instanceGraph || !Array.isArray(state.instanceGraph.instances)) {
    throw new Error('A run state with an instance graph is required.');
  }
  if (!state?.contextStack) throw new Error('A run state with a context stack is required.');
  if (!state?.entityGraph || !Array.isArray(state.entityGraph.entities)) {
    throw new Error('A run state with an entity graph is required.');
  }
}

function markApplied(state, entityId) {
  const frame = activeContext(state.contextStack);
  const applied = [...new Set([...(frame.appliedEntityIds || []), String(entityId)])];
  updateActiveContext(state.contextStack, { appliedEntityIds: applied });
}

function actionForControl(entity, value) {
  const controlType = String(entity?.structural?.controlType || '');
  if (controlType === 'select') return { type: 'select', value };
  if (controlType === 'checkbox' || controlType === 'radio') {
    return { type: 'check', value: value !== false };
  }
  if (controlType === 'button' || controlType === 'link') return { type: 'click' };
  return { type: 'fill', value };
}

function memberEntities(state, group) {
  const byId = new Map(state.entityGraph.entities.map((entity) => [entity.id, entity]));
  return arr(group?.structural?.memberIds).map((id) => byId.get(id)).filter(Boolean);
}

function matchMember(members, wanted) {
  const target = normalize(wanted);
  return members.find((member) => {
    const candidates = [member.name, member.structural?.label, member.structural?.name];
    return candidates.some((value) => normalize(value) === target);
  }) || null;
}

function resolveGroupTargets(state, group, value) {
  const members = memberEntities(state, group);
  if (!members.length) throw new Error(`Logical group ${group.id} has no member controls.`);

  const multiple = ['zeroOrMore', 'oneOrMore'].includes(String(group.structural?.cardinality || ''));
  const requested = multiple ? arr(value) : [value];
  if (!requested.length && multiple) return [];

  const targets = requested.map((choice) => {
    const member = matchMember(members, choice);
    if (!member) throw new Error(`Unknown group choice: ${choice}`);
    return member;
  });
  return [...new Map(targets.map((entity) => [entity.id, entity])).values()];
}

async function executeOne({ page, entity, value, frame, executeAction }) {
  return executeAction({
    page,
    entity,
    activeFrame: frame,
    action: actionForControl(entity, value)
  });
}

export async function applyInputValue({
  state,
  page,
  entity,
  value,
  executeAction = executeControlAction
} = {}) {
  requireState(state);
  if (!entity?.id) throw new Error('An input entity is required.');
  if (!['ui_control', 'ui_group'].includes(entity.type)) {
    throw new Error('Input execution requires a ui_control or ui_group entity.');
  }
  if (typeof executeAction !== 'function') throw new Error('executeAction must be a function.');

  const frame = activeContext(state.contextStack);
  const targets = entity.type === 'ui_group'
    ? resolveGroupTargets(state, entity, value)
    : [entity];

  for (const target of targets) {
    await executeOne({
      page,
      entity: target,
      value: entity.type === 'ui_group' ? true : value,
      frame,
      executeAction
    });
  }

  const instance = upsertInstance(state.instanceGraph, {
    entityId: entity.id,
    value
  });
  markApplied(state, entity.id);

  return {
    entityId: entity.id,
    targetEntityIds: targets.map((target) => target.id),
    instance
  };
}

export async function applyReusableInput({
  state,
  page,
  reusable,
  executeAction = executeControlAction
} = {}) {
  if (!reusable?.entity?.id || !reusable?.instance) {
    throw new Error('A reusable entity and instance are required.');
  }
  return applyInputValue({
    state,
    page,
    entity: reusable.entity,
    value: reusable.instance.value,
    executeAction
  });
}

export async function executeContinuation({
  state,
  page,
  entity,
  executeAction = executeControlAction
} = {}) {
  requireState(state);
  if (entity?.type !== 'ui_control') throw new Error('A continuation ui_control is required.');
  if (!['button', 'link'].includes(String(entity.structural?.controlType || ''))) {
    throw new Error('Continuation must be a button or link.');
  }

  const frame = activeContext(state.contextStack);
  await executeAction({
    page,
    entity,
    activeFrame: frame,
    action: { type: 'click' }
  });
  markApplied(state, entity.id);

  return { entityId: entity.id };
}
