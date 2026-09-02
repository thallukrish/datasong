import crypto from 'node:crypto';
import { snapshotPage } from '../browserCapture.js';
import { preprocessEntity } from '../graph/entityPreprocessor.js';
import { projectEntityState } from '../graph/entityState.js';
import { computeEntityDelta } from '../graph/entityDelta.js';
import { isEmptyEntityDelta } from '../graph/workflowGraph.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function stateId(state) { return `state:${crypto.createHash('sha1').update(JSON.stringify(state)).digest('hex').slice(0, 12)}`; }
function observationId(index) { return `observation:local:${String(index).padStart(3, '0')}`; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function quoteAttr(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

async function capture(page) {
  const snapshot = await snapshotPage(page);
  const graph = preprocessEntity(snapshot);
  const state = projectEntityState(snapshot, graph);
  return { snapshot, graph, state, stateId: stateId(state) };
}

function controlById(graph, fieldId) {
  return [...arr(graph?.fields), ...arr(graph?.actions)].find((field) => field.id === fieldId) || null;
}

function methodFor(graph, fieldId, predicate = () => true) {
  const method = arr(graph?.methods).find((candidate) => candidate.fieldId === fieldId);
  if (!method) return null;
  return arr(method.actions).find(predicate) || null;
}

function groupById(graph, groupId) {
  return arr(graph?.groups).find((group) => group.id === groupId) || null;
}

function fieldLocator(page, field) {
  if (!field) throw new Error('Cannot locate an empty field');
  if (field.domId) return page.locator(`[id="${quoteAttr(field.domId)}"]`).first();
  if (field.name && field.type === 'radio') return page.locator(`input[name="${quoteAttr(field.name)}"][value="${quoteAttr(field.value)}"]`).first();
  if (field.name && field.type === 'checkbox') return page.locator(`input[name="${quoteAttr(field.name)}"]`).first();
  if (field.label) return page.getByLabel(field.label, { exact: true }).first();
  throw new Error(`No browser locator evidence for ${field.id}`);
}

async function executeSafeAction(page, field, action) {
  if (!action || action.safety !== 'safe') throw new Error(`Refusing non-safe action ${action?.id || ''}`);
  const locator = fieldLocator(page, field);
  if (field.type === 'radio' && action.kind === 'select') {
    await locator.check();
    return;
  }
  if (field.type === 'checkbox' && action.kind === 'toggle') {
    if (action.value) await locator.check();
    else await locator.uncheck();
    return;
  }
  throw new Error(`Local explorer does not execute ${field.type}:${action.kind}`);
}

function affectedFieldIds(delta = {}) {
  return unique([
    ...arr(delta.fieldValuesChanged).map((change) => change.fieldId),
    ...arr(delta.fieldsEnabled), ...arr(delta.fieldsDisabled), ...arr(delta.fieldsShown), ...arr(delta.fieldsHidden),
    ...arr(delta.fieldsAdded), ...arr(delta.fieldsRemoved),
    ...Object.keys(delta.optionsAdded || {}), ...Object.keys(delta.optionsRemoved || {})
  ]);
}

function affectedActionIds(delta = {}) {
  return unique([...arr(delta.actionsEnabled), ...arr(delta.actionsDisabled), ...arr(delta.actionsShown), ...arr(delta.actionsHidden)]);
}

function addRelationship(result, relationship) {
  const key = JSON.stringify([
    relationship.kind,
    relationship.groupType || '',
    relationship.groupId || '',
    relationship.sourceFieldId || '',
    relationship.targetGroupId || '',
    arr(relationship.memberFieldIds).slice().sort()
  ]);
  if (result._relationshipKeys.has(key)) return;
  result._relationshipKeys.add(key);
  result.learnedRelationships.push(relationship);
}

function recordObservedEffect(result, before, after, field, action, purpose = '') {
  const delta = computeEntityDelta(before.state, after.state);
  if (isEmptyEntityDelta(delta)) return null;
  const id = observationId(result.observations.length + 1);
  const observation = {
    id,
    entityId: before.graph.entity.id,
    fieldId: field.id,
    actionId: action.id,
    action: { kind: action.kind, value: action.value, purpose: purpose || action.purpose },
    beforeStateId: before.stateId,
    afterStateId: after.stateId,
    delta,
    affectedFieldIds: affectedFieldIds(delta),
    affectedActionIds: affectedActionIds(delta)
  };
  result.observations.push(observation);
  addRelationship(result, {
    kind: 'action_effect',
    sourceFieldId: field.id,
    actionId: action.id,
    affectedFieldIds: observation.affectedFieldIds,
    affectedActionIds: observation.affectedActionIds,
    evidenceIds: [id]
  });
  return observation;
}

function learnEnabledGroups(result, before, after, sourceFieldId, evidenceId) {
  const enabled = new Set(computeEntityDelta(before.state, after.state).fieldsEnabled);
  if (!enabled.size) return;
  for (const group of arr(after.graph.groups)) {
    const members = arr(group.memberFieldIds);
    const enabledMembers = members.filter((fieldId) => enabled.has(fieldId));
    if (!enabledMembers.length) continue;
    addRelationship(result, {
      kind: 'enables_group',
      sourceFieldId,
      targetGroupId: group.id,
      groupType: group.groupType,
      memberFieldIds: members,
      enabledFieldIds: enabledMembers,
      evidenceIds: evidenceId ? [evidenceId] : []
    });
  }
}

async function settle(page, settleMs) {
  if (settleMs > 0) await page.waitForTimeout(settleMs);
}

async function setCheckbox(page, graph, fieldId, checked, settleMs) {
  const field = controlById(graph, fieldId);
  if (!field) throw new Error(`Missing checkbox ${fieldId}`);
  const action = methodFor(graph, fieldId, (candidate) => candidate.kind === 'toggle' && candidate.value === checked);
  if (!action) throw new Error(`Missing checkbox ${checked ? 'check' : 'uncheck'} action for ${fieldId}`);
  await executeSafeAction(page, field, action);
  await settle(page, settleMs);
  return { field, action };
}

async function exploreCheckboxGroup(page, groupId, result, options) {
  const base = await capture(page);
  const group = groupById(base.graph, groupId);
  if (!group || group.groupType !== 'checkbox') return;
  const candidates = arr(group.memberFieldIds).filter((fieldId) => {
    const state = base.state.fields[fieldId];
    return state?.enabled && state?.visible && state?.checked === false;
  });
  if (!candidates.length) return;

  const firstId = candidates[0];
  const firstExec = await setCheckbox(page, base.graph, firstId, true, options.settleMs);
  const afterFirst = await capture(page);
  recordObservedEffect(result, base, afterFirst, firstExec.field, firstExec.action);

  if (candidates.length > 1) {
    const secondId = candidates[1];
    const beforeSecond = afterFirst;
    const secondExec = await setCheckbox(page, beforeSecond.graph, secondId, true, options.settleMs);
    const afterSecond = await capture(page);
    const secondObservation = recordObservedEffect(result, beforeSecond, afterSecond, secondExec.field, secondExec.action);
    const firstStillChecked = afterSecond.state.fields[firstId]?.checked === true;
    const secondChecked = afterSecond.state.fields[secondId]?.checked === true;
    addRelationship(result, {
      kind: firstStillChecked && secondChecked ? 'multi_select' : 'mutually_exclusive',
      groupType: 'checkbox',
      groupId: group.id,
      memberFieldIds: [...group.memberFieldIds],
      evidenceIds: secondObservation ? [secondObservation.id] : []
    });

    const current = await capture(page);
    if (current.state.fields[secondId]?.checked === true) await setCheckbox(page, current.graph, secondId, false, options.settleMs);
  }

  const current = await capture(page);
  if (current.state.fields[firstId]?.checked === true) await setCheckbox(page, current.graph, firstId, false, options.settleMs);
}

async function exploreRadioGroup(page, initial, group, result, options) {
  const originalId = arr(group.memberFieldIds).find((fieldId) => initial.state.fields[fieldId]?.checked === true) || '';
  const alternatives = arr(group.memberFieldIds).filter((fieldId) => fieldId !== originalId && initial.state.fields[fieldId]?.enabled && initial.state.fields[fieldId]?.visible);
  if (!alternatives.length) return;

  for (const fieldId of alternatives) {
    const before = await capture(page);
    const field = controlById(before.graph, fieldId);
    const action = methodFor(before.graph, fieldId, (candidate) => candidate.kind === 'select');
    if (!field || !action || action.safety !== 'safe') continue;

    try {
      await executeSafeAction(page, field, action);
      await settle(page, options.settleMs);
      const after = await capture(page);
      const observation = recordObservedEffect(result, before, after, field, action);
      if (observation) {
        const selected = after.state.fields[fieldId]?.checked === true;
        const otherSelected = arr(group.memberFieldIds).filter((memberId) => memberId !== fieldId && after.state.fields[memberId]?.checked === true);
        if (selected && otherSelected.length === 0) {
          addRelationship(result, {
            kind: 'mutually_exclusive',
            groupType: 'radio',
            groupId: group.id,
            memberFieldIds: [...group.memberFieldIds],
            evidenceIds: [observation.id]
          });
        }
        learnEnabledGroups(result, before, after, fieldId, observation.id);
      }

      const enabledCheckboxGroupIds = arr(after.graph.groups)
        .filter((candidate) => candidate.groupType === 'checkbox')
        .filter((candidate) => arr(candidate.memberFieldIds).some((memberId) => after.state.fields[memberId]?.enabled && !before.state.fields[memberId]?.enabled))
        .map((candidate) => candidate.id);
      for (const checkboxGroupId of enabledCheckboxGroupIds) await exploreCheckboxGroup(page, checkboxGroupId, result, options);
    } catch (error) {
      result.errors.push({ fieldId, message: error.message });
    } finally {
      if (originalId) {
        try {
          const current = await capture(page);
          if (current.state.fields[originalId]?.checked !== true) {
            const originalField = controlById(current.graph, originalId);
            const restoreAction = methodFor(current.graph, originalId, (candidate) => candidate.kind === 'select');
            if (originalField && restoreAction?.safety === 'safe') {
              await executeSafeAction(page, originalField, restoreAction);
              await settle(page, options.settleMs);
            }
          }
        } catch (error) {
          result.errors.push({ fieldId: originalId, message: `restore failed: ${error.message}` });
        }
      }
    }
  }
}

export async function exploreLocalEntity(page, options = {}) {
  const settings = { settleMs: Number.isFinite(Number(options.settleMs)) ? Math.max(0, Number(options.settleMs)) : 250 };
  const initial = await capture(page);
  const result = {
    entity: structuredClone(initial.graph.entity),
    initialStateId: initial.stateId,
    finalStateId: '',
    observations: [],
    learnedRelationships: [],
    outgoingCandidates: arr(initial.graph.actions).map((actionField) => ({
      fieldId: actionField.id,
      label: actionField.label,
      type: actionField.type,
      href: actionField.href || '',
      executableNow: !!(actionField.visible && !actionField.disabled),
      safety: methodFor(initial.graph, actionField.id)?.safety || methodFor(initial.graph, actionField.id)?.actions?.[0]?.safety || 'policy-required'
    })),
    restored: false,
    errors: [],
    _relationshipKeys: new Set()
  };

  for (const group of arr(initial.graph.groups).filter((candidate) => candidate.groupType === 'radio')) {
    await exploreRadioGroup(page, initial, group, result, settings);
  }

  for (const group of arr(initial.graph.groups).filter((candidate) => candidate.groupType === 'checkbox')) {
    const current = await capture(page);
    if (arr(group.memberFieldIds).some((fieldId) => current.state.fields[fieldId]?.enabled)) await exploreCheckboxGroup(page, group.id, result, settings);
  }

  const final = await capture(page);
  result.finalStateId = final.stateId;
  result.restored = JSON.stringify(final.state.fields) === JSON.stringify(initial.state.fields);
  delete result._relationshipKeys;
  return result;
}
