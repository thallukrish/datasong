function collectStats(node) {
  let dataControls = 0;
  let actionControls = 0;
  let controls = 0;
  const walk = (n, ancestorHidden = false) => {
    if (!n || typeof n !== 'object') return;
    const hidden = ancestorHidden || !!n.hidden;
    if (n.control === true) {
      if (hidden) return;
      controls += 1;
      const tag = String(n.tag || '').toLowerCase();
      const type = String(n.type || '').toLowerCase();
      const role = String(n.role || '').toLowerCase();
      const isButton = tag === 'button' || role === 'button' || ['button', 'submit', 'reset', 'image'].includes(type);
      if (isButton) actionControls += 1;
      else if (type !== 'hidden') dataControls += 1;
      return;
    }
    for (const child of Array.isArray(n.children) ? n.children : []) walk(child, hidden);
  };
  walk(node);
  return { dataControls, actionControls, controls };
}

export function selectEntityRoot(root = {}) {
  const candidates = [];
  const visit = (node, depth = 0, ancestorHidden = false) => {
    if (!node || typeof node !== 'object') return;
    const hidden = ancestorHidden || !!node.hidden;
    if (hidden) return;
    const stats = collectStats(node);
    if (stats.dataControls > 0) candidates.push({ node, depth, ...stats, hasAction: stats.actionControls > 0 });
    for (const child of Array.isArray(node.children) ? node.children : []) {
      if (child?.control === true) continue;
      visit(child, depth + 1, hidden);
    }
  };
  visit(root);
  if (!candidates.length) return root;
  const withActions = candidates.filter((candidate) => candidate.hasAction);
  const pool = withActions.length ? withActions : candidates;
  pool.sort((a, b) => b.depth - a.depth || b.dataControls - a.dataControls || a.controls - b.controls);
  return pool[0].node;
}
