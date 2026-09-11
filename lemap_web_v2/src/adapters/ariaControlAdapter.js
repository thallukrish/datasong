import { canonicalControl, labelForNode } from './controlAdapterUtils.js';

const ROLE_TYPES = new Map([
  ['button', 'button'],
  ['link', 'link'],
  ['radio', 'radio'],
  ['checkbox', 'checkbox'],
  ['textbox', 'text'],
  ['combobox', 'select'],
  ['spinbutton', 'number'],
  ['listbox', 'select']
]);

export const ariaControlAdapter = {
  name: 'aria-control',
  parse(node = {}) {
    const role = String(node?.attributes?.role || '').toLowerCase();
    const controlType = ROLE_TYPES.get(role);
    if (!controlType) return null;
    const allowDescendantText = ['button', 'link', 'radio', 'checkbox'].includes(controlType);
    const label = labelForNode(node, { allowDescendantText });
    if (!label) return null;
    return canonicalControl(node, { controlType, label, sourceAdapter: 'aria-control' });
  }
};
