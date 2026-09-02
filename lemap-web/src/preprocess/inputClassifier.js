function looksLikeDateHint(node = {}) {
  const hint = `${node.placeholder || ''} ${node.pattern || ''} ${node.label || ''}`.toUpperCase();
  return /(DD[^A-Z0-9]?MM[^A-Z0-9]?YYYY|YYYY[^A-Z0-9]?MM[^A-Z0-9]?DD|MM[^A-Z0-9]?DD[^A-Z0-9]?YYYY)/.test(hint);
}

export function classifyInput(node = {}) {
  const tag = String(node.tag || '').toLowerCase();
  const type = String(node.type || '').toLowerCase();
  const role = String(node.role || '').toLowerCase();
  if (type === 'hidden') return 'technical_hidden';
  if (tag === 'select' || tag === 'mat-select' || role === 'listbox') return 'select';
  if (role === 'combobox' || node.autocomplete === 'list') return 'autocomplete';
  if (tag === 'button' || role === 'button' || ['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
  if (type === 'radio' || role === 'radio') return 'radio';
  if (type === 'checkbox' || role === 'checkbox') return 'checkbox';
  if (type === 'date' || role === 'date' || looksLikeDateHint(node)) return 'date';
  if (type === 'number' || role === 'spinbutton') return 'number';
  if (type === 'file') return 'file';
  if (tag === 'input' || tag === 'textarea' || role === 'textbox' || ['text', 'email', 'tel', 'search', 'password', 'url'].includes(type)) return 'text';
  if (tag.includes('-')) return 'composite';
  return 'unknown';
}
