import { CallPathIndexer } from './callPathIndexer.js';

function arr(value) { return Array.isArray(value) ? value : []; }

function lcsLength(a, b) {
  const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = a[i - 1] === b[j - 1]
        ? rows[i - 1][j - 1] + 1
        : Math.max(rows[i - 1][j], rows[i][j - 1]);
    }
  }
  return rows[a.length][b.length];
}

function edgeLabel(relation) {
  if (relation === 'routes_to') return 'NAVIGATE';
  if (relation === 'calls') return 'CALL';
  if (relation === 'returns_to') return 'NEXT';
  if (relation === 'triggers') return 'TRIGGER';
  if (relation === 'handles') return 'HANDLE';
  if (relation === 'on_success') return 'ON_SUCCESS';
  if (relation === 'on_failure') return 'ON_FAILURE';
  if (relation === 'delayed_trigger') return 'DELAYED_TRIGGER';
  return String(relation || 'NEXT').toUpperCase();
}

export class CallPathIndexerV2 extends CallPathIndexer {
  walk(symbolId, prefix, active, outgoing, byId, covered, relations = []) {
    const symbol = byId.get(symbolId);
    if (!symbol) return;
    covered.add(symbolId);

    if (active.has(symbolId)) {
      this.rawPaths.push({
        symbols: prefix,
        relations,
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
        relations,
        terminal: external.length ? { type: 'external', calls: external } : { type: 'end' }
      });
      return;
    }

    for (const edge of edges) {
      this.walk(edge.target.id, nextPrefix, nextActive, outgoing, byId, covered, [...relations, edge.relation]);
    }
  }

  rankMaximalPaths(paths, byId) {
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
        symbolIds: [...path.symbols],
        relations: arr(path.relations),
        signatures: path.symbols.map((id) => this.signatureFor(byId.get(id))),
        sourcePaths: path.symbols.map((id) => byId.get(id)?.sourcePath || '').filter(Boolean)
      }))
      .sort((a, b) => b.functionCount - a.functionCount
        || a.signatures.join('>').localeCompare(b.signatures.join('>')));
  }

  sameStructuralFamily(a, b) {
    const shorter = Math.min(a.symbolIds.length, b.symbolIds.length);
    if (shorter < 4) return false;
    const shared = lcsLength(a.symbolIds, b.symbolIds);
    return shared >= 4 && (shared / shorter) >= 0.72;
  }

  top(limit = 10) {
    const groups = [];
    for (const path of this.rankedPaths) {
      const group = groups.find((candidate) => this.sameStructuralFamily(candidate[0], path));
      if (group) group.push(path);
      else groups.push([path]);
    }

    return groups
      .map((group) => {
        const representative = group[0];
        const alternatives = group.slice(1).map((path) => ({
          pathId: path.id,
          functionCount: path.functionCount,
          signatures: path.signatures,
          relations: path.relations,
          terminal: path.terminal
        }));
        return {
          ...representative,
          branchVariantCount: group.length,
          alternatives
        };
      })
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  render(path) {
    if (!path) return '';
    const signatures = arr(path.signatures);
    const relations = arr(path.relations);
    const parts = [];
    for (let i = 0; i < signatures.length; i += 1) {
      if (i > 0) parts.push(`-[${edgeLabel(relations[i - 1])}]->`);
      parts.push(signatures[i]);
    }
    if (path.terminal?.type === 'cycle') parts.push(`-[CYCLE]-> REF(P${path.cycleRef ?? '?'})`);
    else if (path.terminal?.type === 'external') {
      for (const call of arr(path.terminal.calls)) parts.push(`-[EXTERNAL ${edgeLabel(call.relation)}]-> ${call.name}(...)`);
    }
    return parts.join(' ');
  }

  snapshot() {
    return {
      version: 2,
      fragmentCount: this.fragments.length,
      rawPathCount: this.rawPaths.length,
      rankedPathCount: this.rankedPaths.length,
      groupedPathCount: this.top(Number.MAX_SAFE_INTEGER).length,
      fragments: this.fragments,
      topPaths: this.top(10).map((path) => ({ ...path, rendered: this.render(path) }))
    };
  }
}
