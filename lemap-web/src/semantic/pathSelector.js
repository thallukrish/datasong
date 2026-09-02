function arr(value) { return Array.isArray(value) ? value : []; }

function scorePath(path) {
  const navigation = path.edges.filter((edge) => edge.kind === 'navigation').length;
  const branches = path.edges.filter((edge) => edge.branchCondition).length;
  const entities = new Set(path.edges.flatMap((edge) => [edge.sourceEntityId, edge.targetEntityId]).filter(Boolean)).size;
  return navigation * 4 + branches * 2 + entities + path.edges.length * 0.25;
}

export function selectSemanticPaths(workflowGraph = {}, options = {}) {
  const limit = Math.max(1, Number(options.limit || 8));
  const annotated = new Set(arr(options.annotatedPathIds).map(String));
  const edges = arr(workflowGraph.edges);
  if (!edges.length) return [];

  const outgoing = new Map();
  const incomingCount = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.sourceEntityId)) outgoing.set(edge.sourceEntityId, []);
    outgoing.get(edge.sourceEntityId).push(edge);
    incomingCount.set(edge.targetEntityId, (incomingCount.get(edge.targetEntityId) || 0) + (edge.targetEntityId !== edge.sourceEntityId ? 1 : 0));
  }
  const roots = [...new Set(edges.map((edge) => edge.sourceEntityId))].filter((id) => !incomingCount.get(id));
  const starts = roots.length ? roots : [edges[0].sourceEntityId];
  const paths = [];

  function walk(entityId, pathEdges, seenEdges) {
    const next = arr(outgoing.get(entityId)).filter((edge) => !seenEdges.has(edge.id));
    if (!next.length || pathEdges.length >= 24) {
      if (pathEdges.length) paths.push([...pathEdges]);
      return;
    }
    for (const edge of next) {
      const nextSeen = new Set(seenEdges);
      nextSeen.add(edge.id);
      const extended = [...pathEdges, edge];
      if (edge.targetEntityId === entityId && edge.kind !== 'navigation') {
        const afterLocal = arr(outgoing.get(entityId)).filter((candidate) => !nextSeen.has(candidate.id));
        if (!afterLocal.length) paths.push(extended);
        else walk(entityId, extended, nextSeen);
      } else walk(edge.targetEntityId, extended, nextSeen);
    }
  }

  for (const start of starts) walk(start, [], new Set());
  const unique = new Map();
  for (const pathEdges of paths) {
    const edgeIds = pathEdges.map((edge) => edge.id);
    const id = `path:${edgeIds.join('>')}`;
    if (annotated.has(id) || unique.has(id)) continue;
    const entityIds = [...new Set(pathEdges.flatMap((edge) => [edge.sourceEntityId, edge.targetEntityId]).filter(Boolean))];
    unique.set(id, { id, edgeIds, entityIds, edges: pathEdges.map((edge) => ({ ...edge })), score: scorePath({ edges: pathEdges }) });
  }
  return [...unique.values()].sort((a, b) => b.score - a.score || b.edges.length - a.edges.length).slice(0, limit);
}
