import { canonicalControl, labelForNode } from './controlAdapterUtils.js';

const INPUT_TYPES = new Set([
  'text', 'email', 'tel', 'url', 'search', 'password', 'number', 'date', 'datetime-local',
  'month', 'week', 'time', 'color', 'range', 'file', 'radio', 'checkbox'
]);

function nativeType(node = {}) {
  const tag = String(node.tag || '').toLowerCase();
  const attributes = node.attributes || {};
  if (tag === 'button') return 'button';
  if (tag === 'a' && attributes.href) return 'link';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag !== 'input') return '';
  const type = String(attributes.type || 'text').toLowerCase();
  return INPUT_TYPES.has(type) ? type : 'text';
}

export const nativeControlAdapter = {
  name: 'native-control',
  parse(node = {}) {
    const controlType = nativeType(node);
    if (!controlType) return null;
    const allowDescendantText = ['button', 'link', 'radio', 'checkbox'].includes(controlType);
    const label = labelForNode(node, { allowDescendantText });
    if (!label) return null;
    return canonicalControl(node, { controlType, label, sourceAdapter: 'native-control' });
  }
};
