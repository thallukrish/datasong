import { snapshotPage } from '../browserCapture.js';
import { preprocessEntity } from '../graph/entityPreprocessor.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function quoteAttr(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function fieldShape(entityOrField = {}) {
  if (entityOrField.structural) {
    return {
      id: entityOrField.id,
      domId: entityOrField.structural.domId || '',
      name: entityOrField.structural.name || '',
      label: entityOrField.name || '',
      disabled: !!entityOrField.structural.disabled,
      tag: entityOrField.structural.tag || '',
      role: entityOrField.structural.role || '',
      valueDomain: arr(entityOrField.structural.values)
    };
  }
  return entityOrField;
}

function fieldLocator(page, entityOrField = {}) {
  const field = fieldShape(entityOrField);
  if (field.domId) return page.locator(`[id="${quoteAttr(field.domId)}"]`).first();
  if (field.name) return page.locator(`[name="${quoteAttr(field.name)}"]`).first();
  if (field.label) return page.getByLabel(field.label, { exact: true }).first();
  return null;
}

function canEnumerateTransientDomain(entityOrField = {}) {
  const field = fieldShape(entityOrField);
  if (arr(field.valueDomain).length) return false;
  if (field.disabled) return false;
  const tag = String(field.tag || '').toLowerCase();
  const role = String(field.role || '').toLowerCase();
  return tag === 'mat-select' || role === 'combobox';
}

async function structurallyAvailable(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.visibility !== 'collapse'
      && !element.hasAttribute('hidden')
      && element.getAttribute('aria-hidden') !== 'true';
  }).catch(() => false);
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

export async function enumerateEntityValueDomain(page, entityOrField = {}) {
  if (!canEnumerateTransientDomain(entityOrField)) return [...arr(fieldShape(entityOrField).valueDomain)];
  const locator = fieldLocator(page, entityOrField);
  if (!locator || !await locator.count()) return [];
  if (!await structurallyAvailable(locator)) return [];

  try {
    await locator.click({ timeout: 750 });
  } catch {
    await locator.evaluate((element) => element.click());
  }

  await page.waitForTimeout(50);
  const values = await visibleOptionLabels(page);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(25);
  return values;
}

export async function exploreReadOnlyEntity(page) {
  const snapshot = await snapshotPage(page);
  const graph = preprocessEntity(snapshot);
  const remainingVisibleOptions = await visibleOptionLabels(page).catch(() => []);
  const errors = [];
  if (remainingVisibleOptions.length) {
    errors.push({
      stage: 'unexpected_value_domain_overlay',
      message: 'A finite-choice option overlay was already visible during page capture.'
    });
  }

  return {
    snapshot,
    graph,
    restored: remainingVisibleOptions.length === 0,
    errors
  };
}
