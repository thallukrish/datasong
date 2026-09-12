import { canonicalControl, labelForNode } from './controlAdapterUtils.js';

const MATERIAL_TYPES = new Map([
  ['mat-radio-button', 'radio'],
  ['mat-checkbox', 'checkbox'],
  ['mat-select', 'select']
]);

function normalize(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function classifyHostClickError(error) {
  const text = String(error?.message || '').toLowerCase();
  if (text.includes('intercepts pointer events') || text.includes('intercepted')) return 'POINTER_INTERCEPTED';
  if (text.includes('not visible') || text.includes('hidden')) return 'NOT_VISIBLE';
  if (text.includes('detached') || text.includes('not attached')) return 'DETACHED';
  if (text.includes('disabled')) return 'DISABLED';
  if (text.includes('timeout')) return 'TIMEOUT';
  return 'CLICK_FAILED';
}

async function visibleOptionExists(page) {
  if (typeof page?.locator !== 'function') return false;
  try {
    const options = page.locator('[role="option"]');
    if (typeof options?.count !== 'function') return false;
    const count = await options.count();
    for (let index = 0; index < count; index += 1) {
      const option = options.nth(index);
      if (typeof option?.isVisible === 'function' && await option.isVisible()) return true;
    }
  } catch {}
  return false;
}

async function openMaterialSelect(page, locator, probe = null) {
  if (!locator) return false;

  if (probe) {
    probe.hostClickSucceeded = false;
    probe.hostDomClickSucceeded = false;
    probe.hostClickErrorCode = '';
  }

  if (typeof locator.click === 'function') {
    try {
      await locator.click({ timeout: 1000 });
      if (probe) probe.hostClickSucceeded = true;
      return true;
    } catch (error) {
      if (probe) probe.hostClickErrorCode = classifyHostClickError(error);
      if (await visibleOptionExists(page)) return true;
    }
  }

  if (typeof locator.evaluate === 'function') {
    try {
      await locator.evaluate((element) => element.click());
      if (probe) probe.hostDomClickSucceeded = true;
      return true;
    } catch {}
  }

  return false;
}

function optionCandidateMatches(candidate = {}, value = '') {
  const wanted = normalize(value);
  return [candidate.text, candidate.ariaLabel, candidate.dataValue, candidate.value]
    .some((item) => normalize(item) === wanted);
}

async function selectMaterialOption(page, value) {
  if (typeof page?.locator !== 'function') {
    throw new Error('Angular Material option selection requires locator-capable browser access.');
  }

  const wanted = String(value ?? '').trim();
  const options = page.locator('[role="option"],mat-option');
  const count = typeof options?.count === 'function' ? await options.count() : 0;

  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    if (!option) continue;
    if (typeof option.isVisible === 'function' && !await option.isVisible().catch(() => false)) continue;
    if (typeof option.evaluate !== 'function') continue;

    const candidate = await option.evaluate((element) => ({
      text: element.innerText || element.textContent || '',
      ariaLabel: element.getAttribute?.('aria-label') || '',
      dataValue: element.getAttribute?.('data-value') || '',
      value: element.getAttribute?.('value') || ''
    })).catch(() => ({}));

    if (!optionCandidateMatches(candidate, wanted)) continue;
    if (typeof option.click !== 'function') break;
    await option.click();
    return;
  }

  throw new Error(`Could not find Angular Material option matching "${wanted}"`);
}

function isMaterialSelect(entity = {}) {
  return entity?.type === 'ui_control'
    && String(entity.structural?.controlType || '').toLowerCase() === 'select'
    && String(entity.structural?.tag || '').toLowerCase() === 'mat-select';
}

export const angularMaterialAdapter = {
  name: 'angular-material',
  parse(node = {}) {
    const tag = String(node.tag || '').toLowerCase();
    const controlType = MATERIAL_TYPES.get(tag);
    if (!controlType) return null;
    const allowDescendantText = controlType === 'radio' || controlType === 'checkbox';
    const label = labelForNode(node, { allowDescendantText });
    if (!label) return null;
    return canonicalControl(node, { controlType, label, sourceAdapter: 'angular-material' });
  },
  async openValueDomain({ page, entity, locator, probe = null } = {}) {
    if (!isMaterialSelect(entity)) return false;
    return openMaterialSelect(page, locator, probe);
  },
  async executeControlAction({ page, entity, locator, action = {} } = {}) {
    if (!isMaterialSelect(entity)) return false;
    if (String(action?.type || '') !== 'select') return false;

    const opened = await openMaterialSelect(page, locator);
    if (!opened) throw new Error('Could not open Angular Material select control.');
    await selectMaterialOption(page, action.value);
    return true;
  }
};
