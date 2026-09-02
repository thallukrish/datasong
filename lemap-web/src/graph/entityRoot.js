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
  const maxDataControls = Math.max(...pool.map((candidate) => candidate.dataControls));

  // Prefer the deepest cohesive region that still contains a dominant share of the
  // interactive business controls. This avoids both extremes:
  //   1. deepest-first selecting a tiny embedded support/chat widget; and
  //   2. largest-first selecting the whole page shell that contains the business form
  //      plus unrelated widgets/chrome.
  // A 60% retention threshold keeps the main form when the shell adds a few unrelated
  // controls, while falling back to the broader context when no single child dominates.
  const dominant = pool.filter((candidate) => candidate.dataControls >= maxDataControls * 0.6);
  dominant.sort((a, b) =>
    b.depth - a.depth ||
    b.dataControls - a.dataControls ||
    b.actionControls - a.actionControls ||
    a.controls - b.controls
  );
  return dominant[0].node;
}
