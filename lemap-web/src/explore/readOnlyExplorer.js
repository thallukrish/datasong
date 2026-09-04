import crypto from 'node:crypto';
import { snapshotPage } from '../browserCapture.js';
import { preprocessEntity } from '../graph/entityPreprocessor.js';
import { projectEntityState } from '../graph/entityState.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function stateId(state) {
  return `state:${crypto.createHash('sha1').update(JSON.stringify(state)).digest('hex').slice(0, 12)}`;
}

function methodSafety(graph = {}, fieldId = '') {
  const method = arr(graph.methods).find((candidate) => candidate.fieldId === fieldId);
  return arr(method?.actions)[0]?.safety || 'policy-required';
}

function quoteAttr(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function fieldLocator(page, field = {}) {
  if (field.domId) return page.locator(`[id="${quoteAttr(field.domId)}"]`).first();
  if (field.name) return page.locator(`[name="${quoteAttr(field.name)}"]`).first();
  if (field.label) return page.getByLabel(field.label, { exact: true }).first();
  return null;
}

function shouldEnumerateTransientDomain(field = {}, state = {}) {
  if (arr(state.options?.[field.id]).length) return false;
  if (!field.visible || field.disabled) return false;
  const tag = String(field.tag || '').toLowerCase();
  const role = String(field.role || '').toLowerCase();
  return tag === 'mat-select' || role === 'combobox';
}

async function visibleOptionLabels(page) {
  const options = page.locator('[role="option"]');
  const count = await options.count();
  const labels = [];
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    if (!await option.isVisible().catch(() => false)) continue;
    const label = String(await option.innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
    if (label) labels.push(label);
  }
  return [...new Set(labels)];
}

async function openFiniteChoiceWithoutSelecting(locator) {
  try {
    await locator.click({ timeout: 750 });
    return;
  } catch {
    // Structural discovery may identify a real control whose host has no clickable
    // layout box (common with framework/custom-element wrappers and test fixtures).
    // Domain enumeration only needs the control's own click handler to open; it does
    // not select an option. Invoke the host click deterministically as a fallback.
    await locator.evaluate((element) => element.click());
  }
}

async function enumerateTransientDomain(page, field) {
  const locator = fieldLocator(page, field);
  if (!locator || !await locator.count()) return [];
  await openFiniteChoiceWithoutSelecting(locator);
  await page.waitForTimeout(50);
  const values = await visibleOptionLabels(page);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(25);
  return values;
}

export async function exploreReadOnlyEntity(page) {
  const snapshot = await snapshotPage(page);
  const graph = preprocessEntity(snapshot);
  const state = projectEntityState(snapshot, graph);
  const id = stateId(state);
  const valueDomains = {};
  const learnedRelationships = [];
  const errors = [];
  let restored = true;

  for (const field of arr(graph.fields)) {
    let values = arr(state.options?.[field.id]);
    if (!values.length && shouldEnumerateTransientDomain(field, state)) {
      try {
        values = await enumerateTransientDomain(page, field);
      } catch (error) {
        errors.push({ fieldId: field.id, stage: 'enumerate_value_domain', message: String(error?.message || error).slice(0, 300) });
      }
    }
    if (!values.length) continue;
    valueDomains[field.id] = [...values];
    field.valueDomain = [...values];
    learnedRelationships.push({
      kind: 'value_domain',
      sourceFieldId: field.id,
      values: [...values],
      evidenceIds: []
    });
  }

  const remainingVisibleOptions = await visibleOptionLabels(page).catch(() => []);
  if (remainingVisibleOptions.length) {
    restored = false;
    errors.push({ stage: 'restore_value_domain_overlay', message: 'Finite-choice option overlay remained visible after enumeration.' });
  }

  return {
    entity: structuredClone(graph.entity),
    graph,
    state,
    initialStateId: id,
    finalStateId: id,
    observations: [],
    learnedRelationships,
    valueDomains,
    probeBehavior: false,
    outgoingCandidates: arr(graph.actions).map((actionField) => ({
      fieldId: actionField.id,
      label: actionField.label,
      type: actionField.type,
      href: actionField.href || '',
      executableNow: !!(actionField.visible && !actionField.disabled),
      safety: methodSafety(graph, actionField.id)
    })),
    restored,
    errors
  };
}
