import { arr, key } from '../query_v2/modelJson.js';

function joinEvidence(step) {
  const edge = step?.edge || {};
  return {
    from:edge.from,
    to:edge.to,
    relationship:edge.relationship,
    cardinality:edge.cardinality,
    keyMaps:arr(edge.keyMaps),
    evidenced:true
  };
}

function shortestPathBetweenSets(index, sourceKeys, targetKeys) {
  const queue = [];
  const previous = new Map();
  const seen = new Set();

  for (const source of sourceKeys) {
    const k = key(source);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    queue.push(k);
    previous.set(k, null);
  }

  let reached = '';
  while (queue.length) {
    const current = queue.shift();
    if (targetKeys.has(current)) {
      reached = current;
      break;
    }

    const neighbours = [...arr(index.adjacency.get(current))]
      .sort((a, b) => String(a?.to || '').localeCompare(String(b?.to || '')));
    for (const step of neighbours) {
      const next = key(step?.to);
      if (!next || seen.has(next)) continue;
      seen.add(next);
      previous.set(next, { from:current, step });
      queue.push(next);
    }
  }

  if (!reached) return null;

  const steps = [];
  let cursor = reached;
  while (previous.get(cursor)) {
    const item = previous.get(cursor);
    steps.push(item.step);
    cursor = item.from;
  }
  steps.reverse();
  return { reached, steps };
}

export function connectEvidenceEntities(index, evidenceEntities) {
  const terminals = [...new Set(arr(evidenceEntities).map((name) => key(name)).filter(Boolean))];
  if (terminals.length <= 1) {
    return { connected:true, entities:terminals.map((k) => index.entities.get(k)?.name).filter(Boolean), joins:[], paths:[] };
  }

  const tree = new Set([terminals[0]]);
  const remaining = new Set(terminals.slice(1));
  const joins = [];
  const paths = [];

  while (remaining.size) {
    const result = shortestPathBetweenSets(index, tree, remaining);
    if (!result) break;

    const pathEntities = [];
    for (const step of result.steps) {
      const fromKey = key(step.from);
      const toKey = key(step.to);
      tree.add(fromKey);
      tree.add(toKey);
      pathEntities.push(step.from, step.to);
      joins.push(joinEvidence(step));
    }
    remaining.delete(result.reached);
    paths.push([...new Set(pathEntities)]);
  }

  const connected = remaining.size === 0;
  return {
    connected,
    entities:[...tree].map((k) => index.entities.get(k)?.name).filter(Boolean),
    joins,
    paths,
    unconnected:[...remaining].map((k) => index.entities.get(k)?.name || k)
  };
}
