import crypto from 'node:crypto';
import { snapshotPage } from '../browserCapture.js';
import { preprocessEntity } from '../graph/entityPreprocessor.js';
import { projectEntityState } from '../graph/entityState.js';
import { computeEntityDelta } from '../graph/entityDelta.js';
import { isEmptyEntityDelta } from '../graph/workflowGraph.js';
import { chooseBehaviorSamples, normalizeExternalEffect, clusterBehaviorEffects } from './behaviorSampling.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function quoteAttr(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function stateId(state) { return `state:${crypto.createHash('sha1').update(JSON.stringify(state)).digest('hex').slice(0, 12)}`; }
function observationId(index) { return `observation:local:${String(index).padStart(3, '0')}`; }

async function capture(page) {
  const snapshot = await snapshotPage(page);
  const graph = preprocessEntity(snapshot);
  const state = projectEntityState(snapshot, graph);
  return { snapshot, graph, state, stateId: stateId(state) };
}

function controlById(graph, fieldId) {
  return [...arr(graph?.fields), ...arr(graph?.actions)].find((field) => field.id === fieldId) || null;
}

function groupById(graph, groupId) {
  return arr(graph?.groups).find((group) => group.id === groupId) || null;
}

function methodFor(graph, fieldId, predicate = () => true) {
  const method = arr(graph?.methods).find((candidate) => candidate.fieldId === fieldId);
  return arr(method?.actions).find(predicate) || null;
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

async function settle(page, settleMs) {
  if (settleMs > 0) await page.waitForTimeout(settleMs);
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

function affectedFieldIds(delta = {}) {
  return unique([
    ...arr(delta.fieldValuesChanged).map((change) => change.fieldId),
    ...arr(delta.fieldsEnabled), ...arr(delta.fieldsDisabled),
    ...arr(delta.fieldsShown), ...arr(delta.fieldsHidden),
    ...arr(delta.fieldsAdded), ...arr(delta.fieldsRemoved),
    ...Object.keys(delta.optionsAdded || {}), ...Object.keys(delta.optionsRemoved || {})
  ]);
}

function affectedActionIds(delta = {}) {
  return unique([
    ...arr(delta.actionsEnabled), ...arr(delta.actionsDisabled),
    ...arr(delta.actionsShown), ...arr(delta.actionsHidden)
  ]);
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
    sampleValues: arr(item.samples)
      .map((sample) => String(sample?.label || sample?.value || sample?.fieldId || ''))
      .filter(Boolean)
      .slice(0, 10),
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

function comparableStructure(captured = {}) {
  return JSON.stringify({
    entityId: captured.graph?.entity?.id || '',
    fields: arr(captured.graph?.fields).map((field) => [field.id, field.type]).sort((a, b) => a[0].localeCompare(b[0])),
    groups: arr(captured.graph?.groups)
      .map((group) => [group.id, group.groupType, [...arr(group.memberFieldIds)].sort()])
      .sort((a, b) => a[0].localeCompare(b[0])),
    actions: arr(captured.graph?.actions).map((action) => [action.id, action.type]).sort((a, b) => a[0].localeCompare(b[0]))
  });
}

async function openDisposablePage(livePage, initial, options) {
  const context = livePage.context();
  const pagePromise = context.waitForEvent('page', { timeout: 7000 });
  const opened = await livePage.evaluate((url) => !!window.open(url, '_blank'), livePage.url());
  if (!opened) throw new Error('Browser blocked disposable exploration tab');
  const probePage = await pagePromise;
  await probePage.waitForLoadState('domcontentloaded');
  await settle(probePage, Math.max(options.settleMs, 100));
  const baseline = await capture(probePage);
  if (comparableStructure(baseline) !== comparableStructure(initial)) {
    await probePage.close().catch(() => {});
    throw new Error('Disposable page does not reproduce the live structural baseline');
  }
  return { page: probePage, baseline };
}

async function withDisposablePage(livePage, initial, result, options, fn) {
  let probePage;
  try {
    const opened = await openDisposablePage(livePage, initial, options);
    probePage = opened.page;
    return await fn(probePage, opened.baseline);
  } catch (error) {
    result.errors.push({ fieldId: '', message: `disposable exploration failed: ${error.message}` });
    return null;
  } finally {
    await probePage?.close().catch(() => {});
  }
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
          disabled: node.getAttribute('aria-disabled') === 'true'
            || node.hasAttribute('disabled')
            || node.classList.contains('mat-option-disabled')
            || node.classList.contains('mdc-list-item--disabled'),
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
    await locator.click();
    await settle(page, Math.min(settleMs, 100));
    const exact = page.getByRole('option', { name: option.label, exact: true }).first();
    if (await exact.count()) await exact.click();
    else await page.locator('[role="option"],mat-option').filter({ hasText: option.label }).first().click();
    await settle(page, settleMs);
    return;
  }
  throw new Error(`Unsupported selectable field ${field.id}`);
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

async function applyProbeStep(page, step, options) {
  const current = await capture(page);
  const field = controlById(current.graph, step.fieldId);
  if (!field) throw new Error(`Probe prerequisite field ${step.fieldId} is missing`);
  if (step.kind === 'select_option') {
    await chooseSelectOption(page, field, step.option, options.settleMs);
    return;
  }
  if (step.kind === 'radio_select') {
    const action = methodFor(current.graph, field.id, (candidate) => candidate.kind === 'select');
    await executeSafeAction(page, field, action);
    await settle(page, options.settleMs);
    return;
  }
  if (step.kind === 'checkbox_set') {
    const action = methodFor(current.graph, field.id, (candidate) => candidate.kind === 'toggle' && candidate.value === step.checked);
    await executeSafeAction(page, field, action);
    await settle(page, options.settleMs);
    return;
  }
  throw new Error(`Unknown probe prerequisite ${step.kind}`);
}

async function replayProbePath(page, steps, options) {
  for (const step of arr(steps)) await applyProbeStep(page, step, options);
}

async function discoverValueDomainsSandbox(livePage, initial, result, options) {
  await withDisposablePage(livePage, initial, result, options, async (page, baseline) => {
    for (const field of arr(baseline.graph.fields)) {
      if (!field.visible || field.disabled || !['select', 'autocomplete'].includes(field.type)) continue;
      try {
        const selectable = await readSelectableOptions(page, field);
        const values = unique(selectable.map((option) => option.label || option.value));
        if (!values.length) continue;
        result.valueDomains[field.id] = values;
        result.optionDomains[field.id] = selectable;
        addRelationship(result, { kind: 'value_domain', sourceFieldId: field.id, values, evidenceIds: [] });
      } catch (error) {
        result.errors.push({ fieldId: field.id, message: `value-domain discovery failed: ${error.message}` });
      }
    }
  });
}

async function inspectGroupAfterPath(livePage, initial, groupId, path, result, options) {
  return withDisposablePage(livePage, initial, result, options, async (page) => {
    await replayProbePath(page, path, options);
    const current = await capture(page);
    return { group: groupById(current.graph, groupId), current };
  });
}

async function exploreCheckboxGroupSandbox(livePage, initial, groupId, result, options, path = []) {
  const inspected = await inspectGroupAfterPath(livePage, initial, groupId, path, result, options);
  const group = inspected?.group;
  const base = inspected?.current;
  if (!group || group.groupType !== 'checkbox' || !base) return;

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
    seedKey: `${initial.graph.entity.id}:${group.id}:checkbox:${JSON.stringify(path)}`
  });
  const probes = [];

  for (const choice of sampled.samples) {
    await withDisposablePage(livePage, initial, result, options, async (page) => {
      await replayProbePath(page, path, options);
      const before = await capture(page);
      const field = controlById(before.graph, choice.fieldId);
      const action = methodFor(before.graph, choice.fieldId, (candidate) => candidate.kind === 'toggle' && candidate.value === true);
      if (!field || !action || action.safety !== 'safe') return;
      await executeSafeAction(page, field, action);
      await settle(page, options.settleMs);
      const after = await capture(page);
      const observation = recordObservedEffect(result, before, after, field, action, 'individual-probe');
      const delta = observation?.delta || computeEntityDelta(before.state, after.state);
      probes.push({
        sample: choice,
        effect: normalizeExternalEffect(delta, { sourceFieldIds: group.memberFieldIds }),
        evidenceId: observation?.id || ''
      });
    });
  }

  recordBehaviorClasses(result, {
    groupId: group.id,
    groupType: 'checkbox',
    memberFieldIds: group.memberFieldIds,
    probes,
    coverage: sampled.coverage
  });

  if (sampled.samples.length > 1) {
    const firstId = sampled.samples[0].fieldId;
    const secondId = sampled.samples[1].fieldId;
    await withDisposablePage(livePage, initial, result, options, async (page) => {
      await replayProbePath(page, path, options);
      await applyProbeStep(page, { kind: 'checkbox_set', fieldId: firstId, checked: true }, options);
      const beforeSecond = await capture(page);
      const secondField = controlById(beforeSecond.graph, secondId);
      const secondAction = methodFor(beforeSecond.graph, secondId, (candidate) => candidate.kind === 'toggle' && candidate.value === true);
      if (!secondField || !secondAction || secondAction.safety !== 'safe') return;
      await executeSafeAction(page, secondField, secondAction);
      await settle(page, options.settleMs);
      const afterSecond = await capture(page);
      const observation = recordObservedEffect(result, beforeSecond, afterSecond, secondField, secondAction, 'representative-combination');
      const firstStillChecked = afterSecond.state.fields[firstId]?.checked === true;
      const secondChecked = afterSecond.state.fields[secondId]?.checked === true;
      addRelationship(result, {
        kind: firstStillChecked && secondChecked ? 'multi_select' : 'mutually_exclusive',
        groupType: 'checkbox',
        groupId: group.id,
        memberFieldIds: [...group.memberFieldIds],
        representativeFieldIds: [firstId, secondId],
        evidenceIds: observation ? [observation.id] : []
      });
    });
  }
}

async function exploreRadioGroupSandbox(livePage, initial, groupId, result, options, path = []) {
  const inspected = await inspectGroupAfterPath(livePage, initial, groupId, path, result, options);
  const group = inspected?.group;
  const base = inspected?.current;
  if (!group || group.groupType !== 'radio' || !base) return;

  const originalId = arr(group.memberFieldIds).find((fieldId) => base.state.fields[fieldId]?.checked === true) || '';
  const alternatives = arr(group.memberFieldIds).filter((fieldId) => {
    const state = base.state.fields[fieldId];
    return fieldId !== originalId && state?.enabled && state?.visible;
  });
  if (!alternatives.length) return;

  const choices = alternatives.map((fieldId) => {
    const field = controlById(base.graph, fieldId);
    return { fieldId, value: field?.value ?? fieldId, label: field?.label || String(field?.value ?? fieldId) };
  });
  const sampled = chooseBehaviorSamples(choices, {
    maxSamples: options.maxBehaviorSamples,
    seedKey: `${initial.graph.entity.id}:${group.id}:radio:${JSON.stringify(path)}`
  });
  const probes = [];

  for (const choice of sampled.samples) {
    await withDisposablePage(livePage, initial, result, options, async (page) => {
      await replayProbePath(page, path, options);
      const before = await capture(page);
      const field = controlById(before.graph, choice.fieldId);
      const action = methodFor(before.graph, choice.fieldId, (candidate) => candidate.kind === 'select');
      if (!field || !action || action.safety !== 'safe') return;
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
        const selected = after.state.fields[choice.fieldId]?.checked === true;
        const otherSelected = arr(group.memberFieldIds).filter((memberId) => memberId !== choice.fieldId && after.state.fields[memberId]?.checked === true);
        if (selected && otherSelected.length === 0) {
          addRelationship(result, {
            kind: 'mutually_exclusive',
            groupType: 'radio',
            groupId: group.id,
            memberFieldIds: [...group.memberFieldIds],
            evidenceIds: [observation.id]
          });
        }
        learnEnabledGroups(result, before, after, choice.fieldId, observation.id);
      }

      const nextPath = [...path, { kind: 'radio_select', fieldId: choice.fieldId }];
      const newlyEnabledCheckboxGroups = arr(after.graph.groups).filter((candidate) => candidate.groupType === 'checkbox')
        .filter((candidate) => arr(candidate.memberFieldIds).some((memberId) => after.state.fields[memberId]?.enabled && !before.state.fields[memberId]?.enabled));
      for (const checkboxGroup of newlyEnabledCheckboxGroups) {
        await exploreCheckboxGroupSandbox(livePage, initial, checkboxGroup.id, result, options, nextPath);
      }
    });
  }

  recordBehaviorClasses(result, {
    groupId: group.id,
    groupType: 'radio',
    memberFieldIds: group.memberFieldIds,
    probes,
    coverage: sampled.coverage
  });
}

async function exploreSelectFieldSandbox(livePage, initial, field, result, options) {
  const optionsForField = arr(result.optionDomains[field.id]);
  if (!optionsForField.length) return;

  const inspected = await withDisposablePage(livePage, initial, result, options, async (page, baseline) => {
    const currentField = controlById(baseline.graph, field.id);
    if (!currentField) return null;
    const locator = fieldLocator(page, currentField);
    const shape = await selectShape(locator);
    if (shape.tag === 'select') {
      const selected = optionsForField.find((option) => option.selected || option.value === shape.value);
      return { value: selected?.value ?? shape.value, label: selected?.label || '', kind: 'native' };
    }
    return { value: shape.value, label: shape.text, kind: 'composite' };
  });
  if (!inspected) return;

  const selectable = optionsForField.filter((option) => !option.disabled);
  const alternatives = selectable.filter((option) => !(option.value === inspected.value || option.label === inspected.label));
  if (!alternatives.length) return;

  const sampled = chooseBehaviorSamples(alternatives, {
    maxSamples: options.maxBehaviorSamples,
    seedKey: `${initial.graph.entity.id}:${field.id}:select`
  });
  const probes = [];

  for (let index = 0; index < sampled.samples.length; index += 1) {
    const option = sampled.samples[index];
    await withDisposablePage(livePage, initial, result, options, async (page, baseline) => {
      const before = baseline;
      const currentField = controlById(before.graph, field.id);
      if (!currentField || before.state.fields[field.id]?.enabled === false || before.state.fields[field.id]?.visible === false) return;
      await chooseSelectOption(page, currentField, option, options.settleMs);
      const after = await capture(page);
      const action = {
        id: `probe:${field.id}:option:${index + 1}`,
        kind: 'select_option',
        value: option.label || option.value,
        purpose: 'option-probe',
        safety: 'safe'
      };
      const observation = recordObservedEffect(result, before, after, currentField, action, 'option-probe');
      const delta = observation?.delta || computeEntityDelta(before.state, after.state);
      probes.push({
        sample: option,
        effect: normalizeExternalEffect(delta, { sourceFieldId: field.id }),
        evidenceId: observation?.id || ''
      });
      if (observation) learnEnabledGroups(result, before, after, field.id, observation.id);

      const nextPath = [{ kind: 'select_option', fieldId: field.id, option }];
      const newlyEnabledGroups = arr(after.graph.groups).filter((group) => arr(group.memberFieldIds)
        .some((memberId) => after.state.fields[memberId]?.enabled && !before.state.fields[memberId]?.enabled));
      for (const group of newlyEnabledGroups) {
        if (group.groupType === 'radio') await exploreRadioGroupSandbox(livePage, initial, group.id, result, options, nextPath);
        if (group.groupType === 'checkbox') await exploreCheckboxGroupSandbox(livePage, initial, group.id, result, options, nextPath);
      }
    });
  }

  recordBehaviorClasses(result, {
    sourceFieldId: field.id,
    probes,
    coverage: sampled.coverage
  });
  addRelationship(result, {
    kind: 'disposable_probe',
    sourceFieldId: field.id,
    reason: 'behavioral_isolation',
    coverage: sampled.coverage,
    evidenceIds: probes.map((probe) => probe.evidenceId).filter(Boolean)
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
    finalStateId: '',
    observations: [],
    learnedRelationships: [],
    valueDomains: {},
    optionDomains: {},
    probeBehavior: settings.probeBehavior,
    outgoingCandidates: arr(initial.graph.actions).map((actionField) => ({
      fieldId: actionField.id,
      label: actionField.label,
      type: actionField.type,
      href: actionField.href || '',
      executableNow: !!(actionField.visible && !actionField.disabled),
      safety: methodFor(initial.graph, actionField.id)?.safety || 'policy-required'
    })),
    restored: false,
    errors: [],
    _relationshipKeys: new Set()
  };

  await discoverValueDomainsSandbox(page, initial, result, settings);

  if (settings.probeBehavior) {
    for (const field of arr(initial.graph.fields).filter((candidate) => candidate.type === 'select' && candidate.visible && !candidate.disabled)) {
      await exploreSelectFieldSandbox(page, initial, field, result, settings);
    }
    for (const group of arr(initial.graph.groups).filter((candidate) => candidate.groupType === 'radio')) {
      if (arr(group.memberFieldIds).some((fieldId) => initial.state.fields[fieldId]?.enabled && initial.state.fields[fieldId]?.visible)) {
        await exploreRadioGroupSandbox(page, initial, group.id, result, settings, []);
      }
    }
    for (const group of arr(initial.graph.groups).filter((candidate) => candidate.groupType === 'checkbox')) {
      if (arr(group.memberFieldIds).some((fieldId) => initial.state.fields[fieldId]?.enabled && initial.state.fields[fieldId]?.visible)) {
        await exploreCheckboxGroupSandbox(page, initial, group.id, result, settings, []);
      }
    }
  }

  const final = await capture(page);
  result.finalStateId = final.stateId;
  result.restored = JSON.stringify(final.state.fields) === JSON.stringify(initial.state.fields);
  delete result._relationshipKeys;
  delete result.optionDomains;
  return result;
}
