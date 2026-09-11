import { canonicalControl, labelForNode } from './controlAdapterUtils.js';

const MATERIAL_TYPES = new Map([
  ['mat-radio-button', 'radio'],
  ['mat-checkbox', 'checkbox'],
  ['mat-select', 'select']
]);

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
  }
};
