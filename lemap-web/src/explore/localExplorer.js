import crypto from 'node:crypto';
import { snapshotPage } from '../browserCapture.js';
import { preprocessEntity } from '../graph/entityPreprocessor.js';
import { projectEntityState } from '../graph/entityState.js';
import { computeEntityDelta } from '../graph/entityDelta.js';
import { isEmptyEntityDelta } from '../graph/workflowGraph.js';
import { chooseBehaviorSamples, normalizeExternalEffect, clusterBehaviorEffects } from './behaviorSampling.js';

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
  if (field.name) return page.locator(`[name="${quoteAttr(field.name)}"]`).first();
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
    arr(relationship.memberFieldIds).slice().sort(),
    arr(relationship.values),
    relationship.reason || ''
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

function compactBehaviorClasses(clustered = {}) {
  return arr(clustered.classes).map((item) => ({
    id: item.id,
    sampleCount: item.sampleCount,
    wildcard: !!item.wildcard,
    sampleValues: arr(item.samples).map((sample) => String(sample?.label || sample?.value || sample?.fieldId || '')).filter(Boolean).slice(0, 10),
    effect: item.effect
  }));
}

function recordBehaviorClasses(result, {
  sourceFieldId = '', groupId = '', groupType = '', memberFieldIds = [], probes = [], coverage = {}
} = {}) {
  if (!probes.length) return null;
  const clustered = clusterBehaviorEffects(probes, { coverage });
  addRelationship(result, {
    kind: 'behavior_classes',
    sourceFieldId,
    groupId,
    groupType,
    memberFieldIds,
    coverage: clustered.coverage,
    exhaustiveWildcard: clustered.exhaustiveWildcard,
    classes: compactBehaviorClasses(clustered),
    evidenceIds: probes.map((probe) => probe.evidenceId).filter(Boolean)
  });
  return clustered;
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

async function selectShape(locator) {
  return locator.evaluate((el) => ({
    tag: String(el.tagName || '').toLowerCase(),
    role: String(el.getAttribute?.('role') || '').toLowerCase(),
    value: el.value == null ? '' : String(el.value),
    text: String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  }));
}

async function readSelectableOptions(page, field) {
  const locator = fieldLocator(page, field);
  if (!(await locator.count())) return [];
  const shape = await selectShape(locator);
  if (shape.tag === 'select') {
    return locator.evaluate((el) => Array.from(el.options || []).map((option) => ({
      value: String(option.value ?? ''),
      label: String(option.textContent || option.label || option.value || '').replace(/\s+/g, ' ').trim(),
      disabled: !!option.disabled,
      selected: !!option.selected
    })).filter((option) => option.label));
  }
  if (shape.tag === 'mat-select' || shape.role === 'combobox' || shape.role === 'listbox') {
    try {
      await locator.click();
      await settle(page, 50);
      return await page.locator('[role="option"],mat-option').evaluateAll((nodes) => nodes
        .filter((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        })
        .map((node) => ({
          value: String(node.getAttribute('data-value') || node.getAttribute('value') || node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
          label: String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
          disabled: node.getAttribute('aria-disabled') === 'true' || node.hasAttribute('disabled'),
          selected: node.getAttribute('aria-selected') === 'true'
        }))
        .filter((option) => option.label));
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await settle(page, 25);
    }
  }
  return [];
}

async function discoverValueDomain(page, field, result, options) {
  if (!['select', 'autocomplete'].includes(field.type)) return;
  const selectable = await readSelectableOptions(page, field);
  await settle(page, Math.min(options.settleMs, 100));
  const values = unique(selectable.map((option) => option.label || option.value));
  if (!values.length) return;
  result.valueDomains[field.id] = values;
  result.optionDomains[field.id] = selectable;
  addRelationship(result, { kind: 'value_domain', sourceFieldId: field.id, values, evidenceIds: [] });
}

async function discoverValueDomains(page, graph, result, options) {
  for (const field of arr(graph.fields)) {
    if (!field.visible || field.disabled) continue;
    try {
      await discoverValueDomain(page, field, result, options);
    } catch (error) {
      result.errors.push({ fieldId: field.id, message: `value-domain discovery failed: ${error.message}` });
    }
  }
}

async function chooseSelectOption(page, field, option, settleMs) {
  const locator = fieldLocator(page, field);
  const shape = await selectShape(locator);
  if (shape.tag === 'select') {
    await locator.selectOption({ value: String(option.value ?? '') })
      .catch(async () => locator.selectOption({ label: option.label }));
    await settle(page, settleMs);
    return;
  }
  if (shape.tag === 'mat-select' || shape.role === 'combobox' || shape.role === 'listbox') {
    let chosen = false;
    try {
      await locator.click();
      await settle(page, Math.min(settleMs, 100));
      const exact = page.getByRole('option', { name: option.label, exact: true }).first();
      if (await exact.count()) await exact.click();
      else await page.locator('[role="option"],mat-option').filter({ hasText: option.label }).first().click();
      chosen = true;
      await settle(page, settleMs);
      return;
    } finally {
      if (!chosen) {
        await page.keyboard.press('Escape').catch(() => {});
        await settle(page, 25);
      }
    }
  }
  throw new Error(`Unsupported selectable field ${field.id}`);
}

async function currentSelectIdentity(page, field) {
  const locator = fieldLocator(page, field);
  const shape = await selectShape(locator);
  if (shape.tag === 'select') {
    return locator.evaluate((el) => {
      const option = el.options?.[el.selectedIndex];
      return { value: String(el.value ?? ''), label: String(option?.textContent || option?.label || '').replace(/\s+/g, ' ').trim(), kind: 'native' };
    });
  }
  return { value: shape.value, label: shape.text, kind: 'composite' };
}

function reversibleSelectTarget(field, original, result) {
  const choices = arr(result.optionDomains[field.id]);
  if (original.kind === 'native') {
    return choices.find((option) => option.value === original.value) || null;
  }
  return choices.find((option) => !option.disabled && (
    option.selected
    || (original.value && option.value === original.value)
    || (original.label && option.label === original.label)
  )) || null;
}

async function restoreSelect(page, originalField, original, result, options) {
  try {
    const locator = fieldLocator(page, originalField);
    if (!(await locator.count())) throw new Error(`Missing original select locator for ${originalField.id}`);
    const shape = await selectShape(locator);

    if (shape.tag === 'select') {
      await locator.selectOption({ value: String(original.value ?? '') })
        .catch(async () => locator.selectOption({ label: original.label }));
      await settle(page, options.settleMs);
      return;
    }

    const target = reversibleSelectTarget(originalField, original, result);
    if (!target) throw new Error('No reversible original combobox option discovered');
    await chooseSelectOption(page, originalField, target, options.settleMs);
  } catch (error) {
    result.errors.push({ fieldId: originalField.id, message: `select restore failed: ${error.message}` });
  } finally {
    await page.keyboard.press('Escape').catch(() => {});
  }
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

async function restoreCheckbox(page, fieldId, settleMs) {
  const current = await capture(page);
  if (current.state.fields[fieldId]?.checked !== true) return;
  await setCheckbox(page, current.graph, fieldId, false, settleMs);
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

  const choices = candidates.map((fieldId) => {
    const field = controlById(base.graph, fieldId);
    return { fieldId, value: fieldId, label: field?.label || fieldId };
  });
  const sampled = chooseBehaviorSamples(choices, {
    maxSamples: options.maxBehaviorSamples,
    seedKey: `${base.graph.entity.id}:${group.id}:checkbox`
  });
  const probes = [];

  for (const choice of sampled.samples) {
    const fieldId = choice.fieldId;
    try {
      const before = await capture(page);
      const exec = await setCheckbox(page, before.graph, fieldId, true, options.settleMs);
      const after = await capture(page);
      const observation = recordObservedEffect(result, before, after, exec.field, exec.action, 'individual-probe');
      const delta = observation?.delta || computeEntityDelta(before.state, after.state);
      probes.push({
        sample: choice,
        effect: normalizeExternalEffect(delta, { sourceFieldIds: group.memberFieldIds }),
        evidenceId: observation?.id || ''
      });
    } finally {
      await restoreCheckbox(page, fieldId, options.settleMs);
    }
  }

  recordBehaviorClasses(result, {
    groupId: group.id,
    groupType: 'checkbox',
    memberFieldIds: group.memberFieldIds,
    probes,
    coverage: sampled.coverage
  });

  const combinationCandidates = sampled.samples.map((choice) => choice.fieldId);
  if (combinationCandidates.length > 1) {
    const firstId = combinationCandidates[0];
    const secondId = combinationCandidates[1];
    let combinationObservation = null;
    try {
      const beforeFirst = await capture(page);
      await setCheckbox(page, beforeFirst.graph, firstId, true, options.settleMs);
      const beforeSecond = await capture(page);
      const secondExec = await setCheckbox(page, beforeSecond.graph, secondId, true, options.settleMs);
      const afterSecond = await capture(page);
      combinationObservation = recordObservedEffect(result, beforeSecond, afterSecond, secondExec.field, secondExec.action, 'representative-combination');
      const firstStillChecked = afterSecond.state.fields[firstId]?.checked === true;
      const secondChecked = afterSecond.state.fields[secondId]?.checked === true;
      addRelationship(result, {
        kind: firstStillChecked && secondChecked ? 'multi_select' : 'mutually_exclusive',
        groupType: 'checkbox', groupId: group.id, memberFieldIds: [...group.memberFieldIds], representativeFieldIds: [firstId, secondId],
        evidenceIds: combinationObservation ? [combinationObservation.id] : []
      });
    } finally {
      await restoreCheckbox(page, secondId, options.settleMs);
      await restoreCheckbox(page, firstId, options.settleMs);
    }
  }
}

async function clearRadioGroup(page, graph, group, settleMs) {
  for (const fieldId of arr(group.memberFieldIds)) {
    const field = controlById(graph, fieldId);
    if (!field) continue;
    const locator = fieldLocator(page, field);
    if (!(await locator.count())) continue;
    await locator.evaluate((el) => {
      if (!el.checked) return;
      el.checked = false;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  await settle(page, settleMs);
}

async function restoreRadioGroup(page, group, originalId, result, options) {
  try {
    const current = await capture(page);
    if (originalId) {
      if (current.state.fields[originalId]?.checked === true) return;
      const originalField = controlById(current.graph, originalId);
      const restoreAction = methodFor(current.graph, originalId, (candidate) => candidate.kind === 'select');
      if (originalField && restoreAction?.safety === 'safe') {
        await executeSafeAction(page, originalField, restoreAction);
        await settle(page, options.settleMs);
      }
      return;
    }
    await clearRadioGroup(page, current.graph, group, options.settleMs);
  } catch (error) {
    result.errors.push({ fieldId: originalId || group.id, message: `radio restore failed: ${error.message}` });
  }
}

async function exploreRadioGroup(page, initial, group, result, options) {
  const originalId = arr(group.memberFieldIds).find((fieldId) => initial.state.fields[fieldId]?.checked === true) || '';
  const alternatives = arr(group.memberFieldIds).filter((fieldId) => fieldId !== originalId && initial.state.fields[fieldId]?.enabled && initial.state.fields[fieldId]?.visible);
  if (!alternatives.length) return;

  const choices = alternatives.map((fieldId) => {
    const field = controlById(initial.graph, fieldId);
    return { fieldId, value: field?.value ?? fieldId, label: field?.label || String(field?.value ?? fieldId) };
  });
  const sampled = chooseBehaviorSamples(choices, {
    maxSamples: options.maxBehaviorSamples,
    seedKey: `${initial.graph.entity.id}:${group.id}:radio`
  });
  const probes = [];

  for (const choice of sampled.samples) {
    const fieldId = choice.fieldId;
    const before = await capture(page);
    const field = controlById(before.graph, fieldId);
    const action = methodFor(before.graph, fieldId, (candidate) => candidate.kind === 'select');
    if (!field || !action || action.safety !== 'safe') continue;
    try {
      await executeSafeAction(page, field, action);
      await settle(page, options.settleMs);
      const after = await capture(page);
      const observation = recordObservedEffect(result, before, after, field, action);
      const delta = observation?.delta || computeEntityDelta(before.state, after.state);
      probes.push({
        sample: choice,
        effect: normalizeExternalEffect(delta, { sourceFieldIds: group.memberFieldIds }),
        evidenceId: observation?.id || ''
      });
      if (observation) {
        const selected = after.state.fields[fieldId]?.checked === true;
        const otherSelected = arr(group.memberFieldIds).filter((memberId) => memberId !== fieldId && after.state.fields[memberId]?.checked === true);
        if (selected && otherSelected.length === 0) addRelationship(result, {
          kind: 'mutually_exclusive', groupType: 'radio', groupId: group.id, memberFieldIds: [...group.memberFieldIds], evidenceIds: [observation.id]
        });
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
      await restoreRadioGroup(page, group, originalId, result, options);
    }
  }

  recordBehaviorClasses(result, {
    groupId: group.id,
    groupType: 'radio',
    memberFieldIds: group.memberFieldIds,
    probes,
    coverage: sampled.coverage
  });
}

async function exploreSelectField(page, initial, field, result, options) {
  const selectable = arr(result.optionDomains[field.id]).filter((option) => !option.disabled);
  if (!selectable.length) return;
  const original = await currentSelectIdentity(page, field);
  const restoreTarget = reversibleSelectTarget(field, original, result);
  if (!restoreTarget) {
    addRelationship(result, {
      kind: 'probe_skipped',
      sourceFieldId: field.id,
      reason: 'irreversible_initial_state',
      evidenceIds: []
    });
    await page.keyboard.press('Escape').catch(() => {});
    return;
  }

  const alternatives = selectable.filter((option) => !(option.value === original.value || option.label === original.label));
  const sampled = chooseBehaviorSamples(alternatives, {
    maxSamples: options.maxBehaviorSamples,
    seedKey: `${initial.graph.entity.id}:${field.id}:select`
  });
  const probes = [];

  for (let index = 0; index < sampled.samples.length; index += 1) {
    const option = sampled.samples[index];
    try {
      const before = await capture(page);
      const currentField = controlById(before.graph, field.id) || field;
      if (before.state.fields[field.id]?.enabled === false || before.state.fields[field.id]?.visible === false) continue;
      await chooseSelectOption(page, currentField, option, options.settleMs);
      const after = await capture(page);
      const action = { id: `probe:${field.id}:option:${index + 1}`, kind: 'select_option', value: option.label || option.value, purpose: 'option-probe', safety: 'safe' };
      const observation = recordObservedEffect(result, before, after, currentField, action, 'option-probe');
      const delta = observation?.delta || computeEntityDelta(before.state, after.state);
      probes.push({
        sample: option,
        effect: normalizeExternalEffect(delta, { sourceFieldId: field.id }),
        evidenceId: observation?.id || ''
      });
      if (observation) learnEnabledGroups(result, before, after, field.id, observation.id);

      const newlyEnabledGroups = arr(after.graph.groups).filter((group) => arr(group.memberFieldIds)
        .some((memberId) => after.state.fields[memberId]?.enabled && !before.state.fields[memberId]?.enabled));
      for (const group of newlyEnabledGroups) {
        if (group.groupType === 'radio') await exploreRadioGroup(page, after, group, result, options);
        if (group.groupType === 'checkbox') await exploreCheckboxGroup(page, group.id, result, options);
      }
    } catch (error) {
      result.errors.push({ fieldId: field.id, message: `select option probe failed: ${error.message}` });
    } finally {
      await restoreSelect(page, field, original, result, options);
    }
  }

  recordBehaviorClasses(result, {
    sourceFieldId: field.id,
    probes,
    coverage: sampled.coverage
  });
}

export async function exploreLocalEntity(page, options = {}) {
  const settings = {
    settleMs: Number.isFinite(Number(options.settleMs)) ? Math.max(0, Number(options.settleMs)) : 250,
    probeBehavior: options.probeBehavior !== false,
    maxBehaviorSamples: Number.isFinite(Number(options.maxBehaviorSamples)) ? Math.max(1, Number(options.maxBehaviorSamples)) : 10
  };
  const initial = await capture(page);
  const result = {
    entity: structuredClone(initial.graph.entity),
    initialStateId: initial.stateId,
    finalStateId: '', observations: [], learnedRelationships: [], valueDomains: {}, optionDomains: {},
    probeBehavior: settings.probeBehavior,
    outgoingCandidates: arr(initial.graph.actions).map((actionField) => ({
      fieldId: actionField.id, label: actionField.label, type: actionField.type, href: actionField.href || '',
      executableNow: !!(actionField.visible && !actionField.disabled),
      safety: methodFor(initial.graph, actionField.id)?.safety || methodFor(initial.graph, actionField.id)?.actions?.[0]?.safety || 'policy-required'
    })),
    restored: false, errors: [], _relationshipKeys: new Set()
  };

  await discoverValueDomains(page, initial.graph, result, settings);

  if (settings.probeBehavior) {
    for (const field of arr(initial.graph.fields).filter((candidate) => candidate.type === 'select' && candidate.visible && !candidate.disabled)) {
      await exploreSelectField(page, initial, field, result, settings);
    }
    for (const group of arr(initial.graph.groups).filter((candidate) => candidate.groupType === 'radio')) {
      const current = await capture(page);
      const currentGroup = groupById(current.graph, group.id);
      if (currentGroup && arr(currentGroup.memberFieldIds).some((fieldId) => current.state.fields[fieldId]?.enabled)) await exploreRadioGroup(page, current, currentGroup, result, settings);
    }
    for (const group of arr(initial.graph.groups).filter((candidate) => candidate.groupType === 'checkbox')) {
      const current = await capture(page);
      if (arr(group.memberFieldIds).some((fieldId) => current.state.fields[fieldId]?.enabled)) await exploreCheckboxGroup(page, group.id, result, settings);
    }
  }

  const final = await capture(page);
  result.finalStateId = final.stateId;
  result.restored = JSON.stringify(final.state.fields) === JSON.stringify(initial.state.fields);
  delete result._relationshipKeys;
  delete result.optionDomains;
  return result;
}
