function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function descendantText(node = {}) {
  const parts = [];
  const visit = (current) => {
    const direct = clean(current?.directText);
    if (direct) parts.push(direct);
    for (const child of Array.isArray(current?.children) ? current.children : []) visit(child);
  };
  visit(node);
  return clean(parts.join(' '));
}

export function labelForNode(node = {}, { allowDescendantText = false } = {}) {
  const attributes = node?.attributes || {};
  const ariaLabel = clean(attributes['aria-label']);
  if (ariaLabel) return ariaLabel;
  if (allowDescendantText) {
    const text = descendantText(node);
    if (text) return text;
  }
  return clean(attributes.placeholder || attributes.title || '');
}

export function canonicalControl(node = {}, {
  controlType,
  label,
  sourceAdapter
} = {}) {
  if (!controlType || !label || !sourceAdapter) return null;
  const attributes = node?.attributes || {};
  return {
    entityType: 'ui_control',
    controlType: String(controlType),
    tag: String(node?.tag || '').toLowerCase(),
    role: clean(attributes.role),
    name: clean(attributes.name),
    label: clean(label),
    href: clean(attributes.href),
    disabled: attributes.disabled === '' || attributes.disabled === 'disabled' || attributes['aria-disabled'] === 'true',
    required: attributes.required === '' || attributes.required === 'required' || attributes['aria-required'] === 'true',
    sourceAdapter: String(sourceAdapter)
  };
}
