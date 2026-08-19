const EXECUTABLE_RELATIONS = new Set([
  'calls', 'routes_to', 'handles', 'triggers', 'on_success', 'on_failure',
  'returns_to', 'delayed_trigger'
]);

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value || '').trim(); }

export class CallPathIndexer {
  constructor(topology, { executableRelations = EXECUTABLE_RELATIONS } = {}) {
    this.topology = topology;
    this.executableRelations = executableRelations;
    this.reset();
  }

  reset() {
    this.fragments = [];
    this.fragmentByKey = new Map();
    this.rawPaths = [];
    this.rankedPaths = [];
  }

  build() {
    this.reset();
    const symbols = arr(this.topology?.symbols).filter((symbol) => symbol?.id);
    const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
    const outgoing = new Map();
    const indegree = new Map(symbols.map((symbol) => [symbol.id, 0]));

    for (const symbol of symbols) {
      const edges = this.internalEdges(symbol).filter((edge) => byId.has(edge.target.id));
      outgoing.set(symbol.id, edges);
      for (const edge of edges) indegree.set(edge.target.id, (indegree.get(edge.target.id) || 0) + 1);
    }

    const roots = symbols
      .filter((symbol) => (indegree.get(symbol.id) || 0) === 0)
      .sort((a, b) => this.symbolSort(a, b));
    const covered = new Set();
    for (const root of roots) this.walk(root.id, [], new Map(), outgoing, byId, covered);

    // Closed components (including pure cycles) have no indegree-zero root.
    for (const symbol of [...symbols].sort((a, b) => this.symbolSort(a, b))) {
      if (!covered.has(symbol.id)) this.walk(symbol.id, [], new Map(), outgoing, byId, covered);
    }

    this.rawPaths = this.dedupeRawPaths(this.rawPaths);
    this.compressRawPaths(byId);
    this.rankedPaths = this.rankMaximalPaths(this.rawPaths, byId);
    return this.snapshot();
  }

  symbolSort(a, b) {
    return `${a?.sourcePath || ''}#${a?.name || ''}#${a?.id || ''}`
      .localeCompare(`${b?.sourcePath || ''}#${b?.name || ''}#${b?.id || ''}`);
  }

  internalEdges(symbol) {
    if (!symbol) return [];
    if (typeof this.topology?.outboundReferenceCandidates === 'function') {
      return arr(this.topology.outboundReferenceCandidates(symbol))
        .filter(({ relation, target }) => target?.id && this.executableRelations.has(String(relation || '')))
        .sort((a, b) => `${a.relation}:${a.target.id}`.localeCompare(`${b.relation}:${b.target.id}`));
    }
    return [];
  }

  unresolvedExecutableRefs(symbol) {
    if (!symbol || typeof this.topology?.resolveOutboundReference !== 'function') return [];
    return arr(symbol.references)
      .filter((ref) => this.executableRelations.has(String(ref?.relation || '')))
      .filter((ref) => arr(this.topology.resolveOutboundReference(symbol, ref)).length === 0)
      .map((ref) => ({ relation: String(ref.relation || 'calls'), name: text(ref.name || ref.simpleName) }))
      .filter((ref) => ref.name);
  }

  walk(symbolId, prefix, active, outgoing, byId, covered) {
    const symbol = byId.get(symbolId);
    if (!symbol) return;
    covered.add(symbolId);

    if (active.has(symbolId)) {
      this.rawPaths.push({
        symbols: prefix,
        terminal: { type: 'cycle', targetSymbolId: symbolId, targetOffset: active.get(symbolId) }
      });
      return;
    }

    const nextPrefix = [...prefix, symbolId];
    const nextActive = new Map(active);
    nextActive.set(symbolId, nextPrefix.length - 1);
    const edges = outgoing.get(symbolId) || [];

    if (!edges.length) {
      const external = this.unresolvedExecutableRefs(symbol);
      this.rawPaths.push({
        symbols: nextPrefix,
        terminal: external.length ? { type: 'external', calls: external } : { type: 'end' }
      });
      return;
    }

    // Each outgoing edge is a separate branch/path.
    for (const edge of edges) this.walk(edge.target.id, nextPrefix, nextActive, outgoing, byId, covered);
  }

  dedupeRawPaths(paths) {
    const seen = new Set();
    const out = [];
    for (const path of paths) {
      if (!path?.symbols?.length) continue;
      const terminal = path.terminal || { type: 'end' };
      const terminalKey = terminal.type === 'cycle'
        ? `cycle:${terminal.targetSymbolId}`
        : terminal.type === 'external'
          ? `external:${arr(terminal.calls).map((call) => `${call.relation}:${call.name}`).join('|')}`
          : 'end';
      const key = `${path.symbols.join('>')}|${terminalKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(path);
    }
    return out;
  }

  internFragment(symbolId, nextRef = null, terminal = null) {
    const terminalKey = terminal ? JSON.stringify(terminal) : '';
    const key = `${symbolId}|${nextRef ?? ''}|${terminalKey}`;
    if (this.fragmentByKey.has(key)) return this.fragmentByKey.get(key);
    const id = this.fragments.length;
    this.fragments.push({ id, functions: [symbolId], nextRef, terminal });
    this.fragmentByKey.set(key, id);
    return id;
  }

  compressRawPaths(byId) {
    for (const raw of this.rawPaths) {
      let nextRef = null;
      const fragmentIdsByOffset = new Map();
      for (let i = raw.symbols.length - 1; i >= 0; i -= 1) {
        const symbolId = raw.symbols[i];
        let terminal = null;
        if (i === raw.symbols.length - 1 && raw.terminal?.type === 'external') terminal = raw.terminal;
        if (i === raw.symbols.length - 1 && raw.terminal?.type === 'end') terminal = raw.terminal;
        if (i === raw.symbols.length - 1 && raw.terminal?.type === 'cycle') {
          terminal = { type: 'cycle', targetSymbolId: raw.terminal.targetSymbolId };
        }
        const id = this.internFragment(symbolId, nextRef, terminal);
        fragmentIdsByOffset.set(i, id);
        nextRef = id;
      }
      raw.headRef = nextRef;
      if (raw.terminal?.type === 'cycle') {
        const targetRef = fragmentIdsByOffset.get(raw.terminal.targetOffset);
        raw.cycleRef = targetRef ?? null;
      }
      raw.signatures = raw.symbols.map((id) => this.signatureFor(byId.get(id)));
    }
  }

  signatureFor(symbol) {
    if (!symbol) return '';
    return text(symbol.signature) || text(symbol.name) || String(symbol.id || '');
  }

  isStrictSuffix(shorter, longer) {
    if (shorter.symbols.length >= longer.symbols.length) return false;
    const offset = longer.symbols.length - shorter.symbols.length;
    for (let i = 0; i < shorter.symbols.length; i += 1) {
      if (shorter.symbols[i] !== longer.symbols[offset + i]) return false;
    }
    return true;
  }

  rankMaximalPaths(paths, byId) {
    // Do not present suffix subflows separately when they are already contained
    // in a longer path; their compressed representation is still retained and
    // referenced internally.
    const maximal = paths.filter((path, index) => !paths.some((other, otherIndex) =>
      index !== otherIndex && this.isStrictSuffix(path, other)));
    return maximal
      .map((path, index) => ({
        id: `callpath:${index}`,
        headRef: path.headRef,
        entrySymbolId: path.symbols[0],
        functionCount: path.symbols.length,
        cycleRef: path.cycleRef ?? null,
        terminal: path.terminal,
        signatures: path.symbols.map((id) => this.signatureFor(byId.get(id))),
        sourcePaths: path.symbols.map((id) => byId.get(id)?.sourcePath || '').filter(Boolean)
      }))
      .sort((a, b) => b.functionCount - a.functionCount
        || a.signatures.join('>').localeCompare(b.signatures.join('>')));
  }

  top(limit = 10) {
    return this.rankedPaths.slice(0, Math.max(0, Number(limit) || 0));
  }

  render(path) {
    if (!path) return '';
    const lines = arr(path.signatures).filter(Boolean);
    if (path.terminal?.type === 'cycle') lines.push(`REF(P${path.cycleRef ?? '?'}) [cycle]`);
    else if (path.terminal?.type === 'external') {
      for (const call of arr(path.terminal.calls)) lines.push(`${call.name}(...) [external:${call.relation}]`);
    }
    return lines.join(' -> ');
  }

  scoutCandidates(limit = 10) {
    // The Scout/Discovery layer needs a real topology artifact id to traverse.
    // Group branch paths by their entry symbol and attach reconstructed branch
    // signatures as evidence to that entry symbol.
    const grouped = new Map();
    for (const path of this.top(limit * 3)) {
      const current = grouped.get(path.entrySymbolId) || [];
      current.push(path);
      grouped.set(path.entrySymbolId, current);
    }
    return [...grouped.entries()]
      .map(([entrySymbolId, paths]) => {
        const best = paths[0];
        const symbol = this.topology?.symbolById?.get(entrySymbolId);
        return {
          id: entrySymbolId,
          path: `${symbol?.sourcePath || ''}#${symbol?.name || entrySymbolId}`,
          kind: 'call_path_seed',
          relation: 'call_path',
          label: symbol?.name || entrySymbolId,
          hint: `effectiveFunctionCount=${best.functionCount}; reconstructedBranches=${paths.slice(0, 3).map((p) => this.render(p)).join(' || ')}`,
          callPathIds: paths.slice(0, 3).map((p) => p.id),
          effectiveFunctionCount: best.functionCount
        };
      })
      .sort((a, b) => b.effectiveFunctionCount - a.effectiveFunctionCount)
      .slice(0, limit);
  }

  snapshot() {
    return {
      version: 1,
      fragmentCount: this.fragments.length,
      rawPathCount: this.rawPaths.length,
      rankedPathCount: this.rankedPaths.length,
      fragments: this.fragments,
      topPaths: this.top(10).map((path) => ({ ...path, rendered: this.render(path) }))
    };
  }
}
