const DATA_TYPES = new Set(['radio','checkbox','text','number','date','select','autocomplete','file','composite']);

function collectStats(node) {
  let dataControls = 0;
  let actionControls = 0;
  let visibleControls = 0;
  const walk = (n) => {
    if (!n || typeof n !== 'object' || n.hidden) return;
    if (n.control === true) {
      visibleControls += 1;
      const tag = String(n.tag || '').toLowerCase();
      const type = String(n.type || '').toLowerCase();
      const role = String(n.role || '').toLowerCase();
      const isButton = tag === 'button' || role === 'button' || ['button','submit','reset','image'].includes(type);
      if (isButton) actionControls += 1;
      else if (type !== 'hidden') dataControls += 1;
      return;
    }
    for (const child of Array.isArray(n.children) ? n.children : []) walk(child);
  };
  walk(node);
  return { dataControls, actionControls, visibleControls };
}

export function selectActiveWorkflowRoot(root = {}) {
  const candidates = [];
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || node.hidden) return;
    const stats = collectStats(node);
    if (stats.dataControls > 0) {
      candidates.push({ node, depth, ...stats, hasAction: stats.actionControls > 0 });
    }
    for (const child of Array.isArray(node.children) ? node.children : []) {
      if (child?.control === true) continue;
      visit(child, depth + 1);
    }
  };
  visit(root, 0);
  if (!candidates.length) return root;
  const withActions = candidates.filter((x) => x.hasAction);
  const pool = withActions.length ? withActions : candidates;
  pool.sort((a, b) => b.depth - a.depth || b.dataControls - a.dataControls || a.visibleControls - b.visibleControls);
  return pool[0].node;
}
