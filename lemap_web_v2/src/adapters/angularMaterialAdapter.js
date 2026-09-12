import { canonicalControl, labelForNode } from './controlAdapterUtils.js';

const MATERIAL_TYPES = new Map([
  ['mat-radio-button', 'radio'],
  ['mat-checkbox', 'checkbox'],
  ['mat-select', 'select']
]);

function classifyTriggerClickError(error) {
  const text = String(error?.message || '').toLowerCase();
  if (text.includes('intercepts pointer events') || text.includes('intercepted')) return 'POINTER_INTERCEPTED';
  if (text.includes('not visible') || text.includes('hidden')) return 'NOT_VISIBLE';
  if (text.includes('detached') || text.includes('not attached')) return 'DETACHED';
  if (text.includes('disabled')) return 'DISABLED';
  if (text.includes('timeout')) return 'TIMEOUT';
  return 'CLICK_FAILED';
}

async function safeBoolean(fn, fallback = false) {
  try {
    return !!(await fn());
  } catch {
    return fallback;
  }
}

async function openMaterialSelect(locator, probe = null) {
  if (!locator) return false;

  if (typeof locator.locator === 'function') {
    const trigger = locator.locator('.mat-select-trigger, .mat-mdc-select-trigger');
    let triggerCount = 0;
    if (typeof trigger?.count === 'function') {
      try { triggerCount = await trigger.count(); } catch {}
    }
    const first = typeof trigger?.first === 'function' ? trigger.first() : trigger;
    if (probe) {
      probe.triggerCount = triggerCount;
      probe.triggerFound = triggerCount > 0 || !!first;
      probe.triggerAttached = triggerCount > 0;
      probe.triggerVisible = first && typeof first.isVisible === 'function'
        ? await safeBoolean(() => first.isVisible())
        : false;
      probe.triggerEnabled = first && typeof first.isEnabled === 'function'
        ? await safeBoolean(() => first.isEnabled())
        : false;
      probe.triggerClickSucceeded = false;
      probe.triggerClickErrorCode = '';
    }
    if (first && typeof first.click === 'function') {
      try {
        await first.click({ timeout: 1000 });
        if (probe) probe.triggerClickSucceeded = true;
        return true;
      } catch (error) {
        if (probe) probe.triggerClickErrorCode = classifyTriggerClickError(error);
      }
    }
  }

  if (typeof locator.click === 'function') {
    try {
      await locator.click({ timeout: 1000 });
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
  async openValueDomain({ entity, locator, probe = null } = {}) {
    if (entity?.type !== 'ui_control') return false;
    if (String(entity.structural?.controlType || '').toLowerCase() !== 'select') return false;
    if (String(entity.structural?.tag || '').toLowerCase() !== 'mat-select') return false;
    return openMaterialSelect(locator, probe);
  }
};
