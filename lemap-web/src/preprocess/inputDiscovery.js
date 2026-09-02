import crypto from 'node:crypto';
import { classifyInput } from './inputClassifier.js';

const CONTROL_TAGS = new Set(['input', 'button', 'select', 'textarea']);
function hash(value) { return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12); }

export function discoverInputs(root = {}, pageId = '') {
  const inputs = [];
  function walk(node, ancestry = []) {
    if (!node || typeof node !== 'object') return;
    const tag = String(node.tag || '').toLowerCase();
    const label = String(node.label || '').trim();
    const nextAncestry = label && !CONTROL_TAGS.has(tag) ? [...ancestry, { tag, label }] : ancestry;
    if (CONTROL_TAGS.has(tag)) {
      const parent = [...ancestry].reverse().find((x) => x.label) || null;
      const identityBasis = [pageId, parent?.label || '', node.name || '', label, node.value ?? '', tag, node.type || ''].join('|');
      inputs.push({
        id: `input:${hash(identityBasis)}`,
        pageId,
        domId: String(node.domId || node.id || ''),
        name: String(node.name || ''),
        label,
        type: classifyInput(node),
        rawType: String(node.type || ''),
        role: String(node.role || ''),
        tag,
        parentRegionLabel: parent?.label || '',
        parentRegionTag: parent?.tag || '',
        parentGroupId: null,
        required: !!node.required,
        disabled: !!node.disabled,
        visible: !node.hidden,
        readonly: !!node.readonly,
        placeholder: String(node.placeholder || ''),
        value: node.value ?? null,
        valueDomain: Array.isArray(node.options) ? [...node.options] : [],
        attributes: {
          min: node.min ?? null,
          max: node.max ?? null,
          step: node.step ?? null,
          maxlength: node.maxlength ?? null,
          pattern: node.pattern ?? null,
          autocomplete: node.autocomplete ?? null
        }
      });
    }
    for (const child of Array.isArray(node.children) ? node.children : []) walk(child, nextAncestry);
  }
  walk(root, []);
  return inputs;
}
