const arr = (value) => Array.isArray(value) ? value : [];

function child(map, id) {
  if (!map.has(id)) map.set(id, { symbolId:id, children:new Map(), pathIds:new Set(), terminal:false });
  return map.get(id);
}

function sequences(groupedPaths = []) {
  const out = [];
  for (const path of arr(groupedPaths)) {
    const variants = [path, ...arr(path?.alternatives)];
    for (const variant of variants) {
      const ids = arr(variant?.symbolIds);
      if (ids.length) out.push({ pathId:variant?.pathId || path?.id || '', ids });
    }
  }
  return out;
}

export function buildEntryFlowForest(groupedPaths = []) {
  const roots = new Map();
  for (const { pathId, ids } of sequences(groupedPaths)) {
    let level = roots;
    for (let index = 0; index < ids.length; index += 1) {
      const node = child(level, ids[index]);
      if (pathId) node.pathIds.add(pathId);
      if (index === ids.length - 1) node.terminal = true;
      level = node.children;
    }
  }
  return roots;
}

function symbolView(symbolById, symbolId) {
  const symbol = symbolById?.get?.(symbolId);
  return {
    symbolId,
    name:symbol?.name || symbolId,
    signature:symbol?.signature || '',
    sourcePath:symbol?.sourcePath || '',
    startLine:Number(symbol?.startLine || 0),
    endLine:Number(symbol?.endLine || 0),
    entryPoint:!!symbol?.entryPoint
  };
}

function previewNode(node, symbolById, depth) {
  const view = {
    ...symbolView(symbolById, node.symbolId),
    terminal:node.terminal,
    pathIds:[...node.pathIds],
    children:[]
  };
  if (depth > 0) view.children = [...node.children.values()].map((item) => previewNode(item, symbolById, depth - 1));
  return view;
}

export function entryCandidates(groupedPaths = [], symbolById = new Map()) {
  const forest = buildEntryFlowForest(groupedPaths);
  return [...forest.values()].map((node) => previewNode(node, symbolById, 0))
    .sort((a, b) => Number(b.entryPoint) - Number(a.entryPoint) || b.pathIds.length - a.pathIds.length || a.name.localeCompare(b.name));
}

export function lookaheadFromEntry(groupedPaths = [], symbolById = new Map(), entrySymbolId, depth = 3) {
  const forest = buildEntryFlowForest(groupedPaths);
  const root = forest.get(entrySymbolId);
  return root ? previewNode(root, symbolById, Math.max(0, Number(depth) || 0)) : null;
}

export function branchSemanticKey(fromSymbolId, toSymbolId) {
  return `${fromSymbolId}=>${toSymbolId}`;
}

export function mergeBranchSemantics(existing = {}, annotations = []) {
  const next = { ...(existing || {}) };
  for (const item of arr(annotations)) {
    const fromSymbolId = String(item?.fromSymbolId || '').trim();
    const toSymbolId = String(item?.toSymbolId || '').trim();
    const purpose = String(item?.purpose || '').trim();
    if (!fromSymbolId || !toSymbolId || !purpose) continue;
    next[branchSemanticKey(fromSymbolId, toSymbolId)] = {
      fromSymbolId,
      toSymbolId,
      purpose,
      effect:String(item?.effect || '').trim(),
      evidenceSourcePath:String(item?.evidenceSourcePath || '').trim(),
      evidenceStartLine:Number(item?.evidenceStartLine || 0),
      evidenceEndLine:Number(item?.evidenceEndLine || 0)
    };
  }
  return next;
}

export function annotateLookahead(preview, branchSemantics = {}) {
  if (!preview) return null;
  const visit = (node) => ({
    ...node,
    children:arr(node.children).map((childNode) => {
      const edgeSemantic = branchSemantics[branchSemanticKey(node.symbolId, childNode.symbolId)] || null;
      return { ...visit(childNode), edgeSemantic };
    })
  });
  return visit(preview);
}
