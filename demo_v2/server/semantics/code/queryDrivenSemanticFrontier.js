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

function boundaryKind(symbol, structuralRoot) {
  const role = String(symbol?.sourceRole || 'source');
  const explicitKind = String(symbol?.entryKind || symbol?.boundaryKind || '').toLowerCase();
  const name = String(symbol?.simpleName || symbol?.name || '').split('.').at(-1) || '';
  const explicit = !!symbol?.entryPoint || name === 'main' || explicitKind === 'main' || explicitKind === 'cli';
  const external = ['api','route','ui_event','event','callback','job','handler','command'].some((kind) => explicitKind.includes(kind));
  const publicApi = role !== 'test' && name && !name.startsWith('_');
  if (role === 'test') {
    if (explicit) return { kind:'test_explicit', priority:200 };
    if (external) return { kind:'test_external', priority:150 };
    if (publicApi) return { kind:'test_public_api', priority:100 };
    if (structuralRoot) return { kind:'test_structural_root', priority:50 };
    return { kind:'test_other', priority:0 };
  }
  if (explicit) return { kind:'explicit_entry', priority:700 };
  if (external) return { kind:'external_boundary', priority:600 };
  if (publicApi) return { kind:'public_api', priority:500 };
  if (structuralRoot) return { kind:'structural_root', priority:400 };
  return { kind:'other_callable', priority:300 };
}

export function entryCandidates(groupedPaths = [], symbolById = new Map()) {
  const forest = buildEntryFlowForest(groupedPaths);
  const rootIds = new Set(forest.keys());
  const executableIds = new Set();
  const pathIdsBySymbol = new Map();
  for (const { pathId, ids } of sequences(groupedPaths)) {
    for (const id of ids) {
      executableIds.add(id);
      if (!pathIdsBySymbol.has(id)) pathIdsBySymbol.set(id, new Set());
      if (pathId) pathIdsBySymbol.get(id).add(pathId);
    }
  }
  const symbols = symbolById instanceof Map ? [...symbolById.values()] : [];
  return symbols.filter((symbol) => symbol?.id && executableIds.has(symbol.id)).map((symbol) => {
    const boundary = boundaryKind(symbol, rootIds.has(symbol.id));
    return {
      ...symbolView(symbolById, symbol.id),
      structuralRoot:rootIds.has(symbol.id),
      boundaryKind:boundary.kind,
      boundaryPriority:boundary.priority,
      pathIds:[...(pathIdsBySymbol.get(symbol.id) || [])]
    };
  }).sort((a,b) => b.boundaryPriority-a.boundaryPriority || b.pathIds.length-a.pathIds.length || a.name.localeCompare(b.name));
}

export function lookaheadFromEntry(groupedPaths = [], symbolById = new Map(), entrySymbolId, depth = 3) {
  const forest = buildEntryFlowForest(groupedPaths);
  let root = forest.get(entrySymbolId);
  if (!root) {
    const local = new Map();
    for (const { pathId, ids } of sequences(groupedPaths)) {
      const offset = ids.indexOf(entrySymbolId);
      if (offset < 0) continue;
      let level = local;
      for (let index = offset; index < ids.length; index += 1) {
        const node = child(level, ids[index]);
        if (pathId) node.pathIds.add(pathId);
        if (index === ids.length - 1) node.terminal = true;
        level = node.children;
      }
    }
    root = local.get(entrySymbolId);
  }
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
