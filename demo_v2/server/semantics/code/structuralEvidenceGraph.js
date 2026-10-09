import crypto from 'node:crypto';

const arr = (value) => Array.isArray(value) ? value : [];

function workflowId(path) {
  const basis = arr(path?.symbolIds).join('>') || String(path?.id || '');
  return `workflow:${crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12)}`;
}

function addLink(node, id, relationship) {
  if (!node || !id || !relationship) return;
  node.links = arr(node.links);
  if (!node.links.some((link) => link.id === id && link.relationship === relationship)) {
    node.links.push({ id, relationship });
  }
}

export function buildWorkflowGraph({ groupedPaths = [], symbols = [], entityLinks = [] } = {}) {
  const symbolById = new Map(arr(symbols).map((symbol) => [symbol?.id, symbol]));
  const entitiesByFunction = new Map();

  for (const link of arr(entityLinks)) {
    const functionId = String(link?.functionId || '');
    const targetId = String(link?.targetId || '');
    if (!functionId || !targetId) continue;
    if (!entitiesByFunction.has(functionId)) entitiesByFunction.set(functionId, new Set());
    entitiesByFunction.get(functionId).add(targetId);
  }

  const nodes = [];
  const workflowLinks = [];

  for (const path of arr(groupedPaths)) {
    const symbolIds = arr(path?.symbolIds).filter((id) => symbolById.has(id));
    if (!symbolIds.length) continue;

    const id = workflowId(path);
    const touchedEntities = new Set();
    for (const symbolId of symbolIds) {
      for (const entityId of entitiesByFunction.get(symbolId) || []) touchedEntities.add(entityId);
    }

    const node = {
      id,
      type: 'workflow',
      details: {
        name: String(path?.id || id),
        callPathId: String(path?.id || ''),
        entryFunctionId: symbolIds[0],
        exitFunctionId: symbolIds.at(-1),
        functionCount: symbolIds.length,
        entityCount: touchedEntities.size,
        branchVariantCount: Number(path?.branchVariantCount || 0),
        alternateEntranceCount: Number(path?.alternateEntranceCount || 0)
      },
      links: []
    };

    symbolIds.forEach((symbolId, ordinal) => {
      const symbol = symbolById.get(symbolId);
      addLink(node, symbolId, 'contains');
      workflowLinks.push({
        sourceId: id,
        sourceType: 'workflow',
        relationship: 'contains',
        targetId: symbolId,
        targetType: 'function',
        ordinal,
        sourcePath: symbol?.sourcePath || '',
        startLine: Number(symbol?.startLine || 0),
        endLine: Number(symbol?.endLine || 0)
      });
    });

    nodes.push(node);
  }

  return { nodes, workflowLinks };
}

export function mergeStructuralEvidenceNodes(...groups) {
  const byId = new Map();

  for (const node of groups.flatMap((group) => arr(group))) {
    if (!node?.id) continue;
    const prior = byId.get(node.id);
    if (!prior) {
      byId.set(node.id, {
        id: node.id,
        type: node.type,
        details: { ...(node.details || {}) },
        links: arr(node.links).map((link) => ({ ...link }))
      });
      continue;
    }

    prior.type = node.type || prior.type;
    prior.details = { ...(prior.details || {}), ...(node.details || {}) };
    for (const link of arr(node.links)) addLink(prior, link.id, link.relationship);
  }

  return [...byId.values()];
}
