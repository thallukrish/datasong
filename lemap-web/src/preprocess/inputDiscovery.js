import crypto from 'node:crypto';
import { classifyInput } from './inputClassifier.js';

const CONTROL_TAGS = new Set(['input', 'button', 'select', 'textarea']);
const CONTROL_ROLES = new Set(['button', 'radio', 'checkbox', 'textbox', 'combobox', 'spinbutton', 'listbox']);
function hash(value) { return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12); }
function isControlNode(node = {}) {
  return CONTROL_TAGS.has(String(node.tag || '').toLowerCase()) || CONTROL_ROLES.has(String(node.role || '').toLowerCase()) || node.control === true;
}

function stableChoiceIdentity(node = {}, normalizedType = '') {
  if (normalizedType !== 'radio') return '';
  return String(node.value ?? '');
}

export function discoverInputs(root = {}, entityId = '') {
  const inputs = [];
  function walk(node, ancestry = []) {
    if (!node || typeof node !== 'object') return;
    const tag = String(node.tag || '').toLowerCase();
    const label = String(node.label || '').trim();
    const controlNode = isControlNode(node);
    const nextAncestry = label && !controlNode ? [...ancestry, { tag, label }] : ancestry;
    if (controlNode) {
      const normalizedType = classifyInput(node);
      if (normalizedType !== 'technical_hidden') {
        const parent = [...ancestry].reverse().find((x) => x.label) || null;
        const domId = String(node.domId || node.id || '');
        const identityBasis = [
          entityId,
          parent?.label || '',
          domId,
          node.name || '',
          label,
          stableChoiceIdentity(node, normalizedType),
          tag,
          node.type || '',
          node.role || ''
        ].join('|');
        inputs.push({
          id: `field:${hash(identityBasis)}`,
          entityId,
          domId,
          name: String(node.name || ''),
          label,
          type: normalizedType,
          rawType: String(node.type || ''),
          role: String(node.role || ''),
          tag,
          parentRegionLabel: parent?.label || '',
          parentRegionTag: parent?.tag || '',
          regionPath: ancestry.map((x) => x.label),
          parentGroupId: null,
          required: !!node.required,
          disabled: !!node.disabled,
          visible: !node.hidden,
          readonly: !!node.readonly,
          checked: typeof node.checked === 'boolean' ? node.checked : null,
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
    }
    for (const child of Array.isArray(node.children) ? node.children : []) walk(child, nextAncestry);
  }
  walk(root, []);
  return inputs;
}
