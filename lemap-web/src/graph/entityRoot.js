function collectStats(node) {
  let dataControls = 0;
  let actionControls = 0;
  let controls = 0;
  const walk = (n, ancestorHidden = false) => {
    if (!n || typeof n !== 'object') return;
    if (n.control === true) {
      if (ancestorHidden) return;
      const tag = String(n.tag || '').toLowerCase();
      const type = String(n.type || '').toLowerCase();
      const role = String(n.role || '').toLowerCase();
      const isButton = tag === 'button' || role === 'button' || ['button', 'submit', 'reset', 'image'].includes(type);
      if (isButton) {
        controls += 1;
        actionControls += 1;
      } else if (!n.hidden && type !== 'hidden') {
        controls += 1;
        dataControls += 1;
      }
      return;
    }
    const hidden = ancestorHidden || !!n.hidden;
    if (hidden) return;
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

  // Prefer the dominant interactive business region before DOM depth. Portal shells often
  // contain deeply nested support/chat widgets with one input and one button; depth-first
  // selection incorrectly promotes those widgets to the primary semantic entity.
  pool.sort((a, b) =>
    b.dataControls - a.dataControls ||
    b.actionControls - a.actionControls ||
    a.controls - b.controls ||
    b.depth - a.depth
  );
  return pool[0].node;
}
