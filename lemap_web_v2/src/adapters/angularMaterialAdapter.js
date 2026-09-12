import { canonicalControl, labelForNode } from './controlAdapterUtils.js';

const MATERIAL_TYPES = new Map([
  ['mat-radio-button', 'radio'],
  ['mat-checkbox', 'checkbox'],
  ['mat-select', 'select']
]);

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
    if (entity?.type !== 'ui_control') return false;
    if (String(entity.structural?.controlType || '').toLowerCase() !== 'select') return false;
    if (String(entity.structural?.tag || '').toLowerCase() !== 'mat-select') return false;
    return openMaterialSelect(page, locator, probe);
  }
};
