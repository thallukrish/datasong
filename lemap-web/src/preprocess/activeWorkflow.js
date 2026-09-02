const CONTROL_TAGS = new Set(['input', 'button', 'select', 'textarea']);
const CONTROL_ROLES = new Set(['button', 'radio', 'checkbox', 'textbox', 'combobox', 'spinbutton', 'listbox']);

function isControlNode(node = {}) {
  return node.control === true || CONTROL_TAGS.has(String(node.tag || '').toLowerCase()) || CONTROL_ROLES.has(String(node.role || '').toLowerCase());
}

function collectStats(node) {
  let dataControls = 0;
  let actionControls = 0;
  let visibleControls = 0;
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (isControlNode(n)) {
      const tag = String(n.tag || '').toLowerCase();
      const type = String(n.type || '').toLowerCase();
      const role = String(n.role || '').toLowerCase();
      const isButton = tag === 'button' || role === 'button' || ['button', 'submit', 'reset', 'image'].includes(type);
      if (isButton) actionControls += 1;
      else if (type !== 'hidden') dataControls += 1;
      if (!n.hidden) visibleControls += 1;
      return;
    }
    if (n.hidden) return;
    for (const child of Array.isArray(n.children) ? n.children : []) walk(child);
  };
  walk(node);
  return { dataControls, actionControls, visibleControls };
}

export function selectActiveWorkflowRoot(root = {}) {
  const candidates = [];
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || node.hidden || isControlNode(node)) return;
    const stats = collectStats(node);
    if (stats.dataControls > 0) candidates.push({ node, depth, ...stats, hasAction: stats.actionControls > 0 });
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child, depth + 1);
  };
  visit(root, 0);
  if (!candidates.length) return root;
  const withActions = candidates.filter((x) => x.hasAction);
  const pool = withActions.length ? withActions : candidates;
  pool.sort((a, b) => b.depth - a.depth || b.dataControls - a.dataControls || a.visibleControls - b.visibleControls);
  return pool[0].node;
}
