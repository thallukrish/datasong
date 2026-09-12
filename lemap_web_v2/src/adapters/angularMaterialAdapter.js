import { canonicalControl, labelForNode } from './controlAdapterUtils.js';

const MATERIAL_TYPES = new Map([
  ['mat-radio-button', 'radio'],
  ['mat-checkbox', 'checkbox'],
  ['mat-select', 'select']
]);

async function openMaterialSelect(locator) {
  if (!locator) return false;

  if (typeof locator.locator === 'function') {
    const trigger = locator.locator('.mat-select-trigger, .mat-mdc-select-trigger');
    const first = typeof trigger?.first === 'function' ? trigger.first() : trigger;
    if (first && typeof first.click === 'function') {
      try {
        await first.click({ timeout: 1000 });
        return true;
      } catch {}
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
  async openValueDomain({ entity, locator } = {}) {
    if (entity?.type !== 'ui_control') return false;
    if (String(entity.structural?.controlType || '').toLowerCase() !== 'select') return false;
    if (String(entity.structural?.tag || '').toLowerCase() !== 'mat-select') return false;
    return openMaterialSelect(locator);
  }
};
