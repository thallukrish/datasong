export function classifyInput(node = {}) {
  const tag = String(node.tag || '').toLowerCase();
  const type = String(node.type || '').toLowerCase();
  const role = String(node.role || '').toLowerCase();
  if (role === 'combobox' || node.autocomplete === 'list') return 'autocomplete';
  if (tag === 'select' || role === 'listbox') return 'select';
  if (tag === 'button' || ['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
  if (type === 'radio') return 'radio';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'date' || role === 'date') return 'date';
  if (type === 'number' || role === 'spinbutton') return 'number';
  if (type === 'file') return 'file';
  if (tag === 'input' || tag === 'textarea' || ['text', 'email', 'tel', 'search', 'password', 'url'].includes(type)) return 'text';
  if (tag.includes('-')) return 'composite';
  return 'unknown';
}
