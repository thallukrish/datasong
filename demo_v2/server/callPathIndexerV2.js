import { CallPathIndexer } from './callPathIndexer.js';

function arr(value) { return Array.isArray(value) ? value : []; }

function commonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

function contiguousContainment(container, candidate) {
  if (!candidate.length || candidate.length > container.length) return false;
  outer: for (let offset = 0; offset <= container.length - candidate.length; offset += 1) {
    for (let i = 0; i < candidate.length; i += 1) {
      if (container[offset + i] !== candidate[i]) continue outer;
    }
    return true;
  }
  return false;
}

function longestCommonContiguousLength(a, b) {
  if (!a.length || !b.length) return 0;
  let best = 0;
  const previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return best;
}

function xmlAttr(signature, name) {
  const match = String(signature || '').match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'));
  return match ? match[1].trim() : '';
}

function xmlTag(signature) {
  const match = String(signature || '').trim().match(/^<\/?(?:[\w.-]+:)?([\w.-]+)/);
  return match ? match[1].toLowerCase() : '';
}

function navigationKey(url) {
  const clean = String(url || '').trim().split(/[?#]/)[0].replace(/\\/g, '/').replace(/\/+$/, '');
  if (!clean) return '';
  if (clean === '.') return 'self';
  const parts = clean.split('/').filter(Boolean);
  return (parts.at(-1) || clean).replace(/\.xml$/i, '').toLowerCase();
}

function normalizeFlowToken(signature) {
  const raw = String(signature || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('<')) return `code:${raw.replace(/\s+/g, ' ').toLowerCase()}`;

  const tag = xmlTag(raw);
  const name = xmlAttr(raw, 'name');
  const entity = xmlAttr(raw, 'entity-name');
  const url = xmlAttr(raw, 'url');
  const location = xmlAttr(raw, 'location');
  const valueField = xmlAttr(raw, 'value-field');

  // Containers/local data-shaping nodes remain in the rendered evidence but do
  // not distinguish executable flow families.
  if (['screen', 'actions', 'script', 'if', 'else', 'condition', 'iterate', 'set'].includes(tag)) return '';

  if (tag === 'transition' || tag === 'transition-include') return name ? `transition:${name.toLowerCase()}` : tag;
  if (tag === 'service-call') return name ? `service:${name.toLowerCase()}` : tag;
  if (['default-response', 'conditional-response', 'error-response'].includes(tag)) {
    const target = navigationKey(url);
    return target ? `navigate:${target}` : tag;
  }
  if (tag.startsWith('entity-')) {
    const target = entity || valueField || name;
    return target ? `${tag}:${target.toLowerCase()}` : tag;
  }
  if (tag === 'subscreens-item') {
    const target = name || location;
    return target ? `subscreen:${target.toLowerCase()}` : tag;
  }
  return name ? `${tag}:${name.toLowerCase()}` : tag;
}

function normalizedFlowTokens(signatures) {
  const out = [];
  for (const signature of arr(signatures)) {
    const token = normalizeFlowToken(signature);
    if (!token || out.at(-1) === token) continue;
    out.push(token);
  }
  return out;
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
      .map((path, index) => {
        const signatures = path.symbols.map((id) => this.signatureFor(byId.get(id)));
        return {
          id: `callpath:${index}`,
          headRef: path.headRef,
          entrySymbolId: path.symbols[0],
          functionCount: path.symbols.length,
          cycleRef: path.cycleRef ?? null,
          terminal: path.terminal,
          symbolIds: [...path.symbols],
          relations: arr(path.relations),
          signatures,
          normalizedFlowTokens: normalizedFlowTokens(signatures),
          sourcePaths: path.symbols.map((id) => byId.get(id)?.sourcePath || '').filter(Boolean)
        };
      })
      .sort((a, b) => b.functionCount - a.functionCount
        || a.signatures.join('>').localeCompare(b.signatures.join('>')));
  }

  sameBranchFamily(a, b) {
    const aa = arr(a.normalizedFlowTokens);
    const bb = arr(b.normalizedFlowTokens);
    const shorter = Math.min(aa.length, bb.length);
    if (shorter < 3) return false;
    const sharedPrefix = commonPrefixLength(aa, bb);
    return sharedPrefix >= 3 && (sharedPrefix / shorter) >= 0.75;
  }

  sameAlternateEntranceFamily(a, b) {
    const aa = arr(a.normalizedFlowTokens);
    const bb = arr(b.normalizedFlowTokens);
    const shorter = Math.min(aa.length, bb.length);
    if (shorter < 3) return false;
    const sharedSuffix = commonSuffixLength(aa, bb);
    if (sharedSuffix < 3 || (sharedSuffix / shorter) < 0.8) return false;
    const aPrefix = aa.length - sharedSuffix;
    const bPrefix = bb.length - sharedSuffix;
    return aPrefix <= 2 && bPrefix <= 2;
  }

  sameNearNormalizedFamily(a, b) {
    const aa = arr(a.normalizedFlowTokens);
    const bb = arr(b.normalizedFlowTokens);
    const shorter = aa.length <= bb.length ? aa : bb;
    const longer = aa.length <= bb.length ? bb : aa;
    if (shorter.length < 3) return false;

    // Safest near-duplicate case: one normalized path is literally contained in
    // the other and only one or two meaningful executable steps differ.
    if (longer.length - shorter.length <= 2 && contiguousContainment(longer, shorter)) return true;

    // Also absorb tiny internal XML-dialect variations when almost the entire
    // shorter business skeleton is one common contiguous block.
    const common = longestCommonContiguousLength(aa, bb);
    const nonSharedA = aa.length - common;
    const nonSharedB = bb.length - common;
    return common >= 3
      && (common / shorter.length) >= 0.8
      && nonSharedA <= 2
      && nonSharedB <= 2;
  }

  sameStructuralFamily(a, b) {
    const aa = arr(a.normalizedFlowTokens);
    const bb = arr(b.normalizedFlowTokens);
    if (aa.length && aa.length === bb.length && aa.every((token, index) => token === bb[index])) return true;
    return this.sameAlternateEntranceFamily(a, b)
      || this.sameBranchFamily(a, b)
      || this.sameNearNormalizedFamily(a, b);
  }

  familyRelation(representative, path) {
    if (this.sameAlternateEntranceFamily(representative, path)) return 'alternate_entrance';
    if (this.sameBranchFamily(representative, path)) return 'branch';
    if (this.sameNearNormalizedFamily(representative, path)) return 'normalized_variant';
    return 'grouped_variant';
  }

  top(limit = 10) {
    const groups = [];
    for (const path of this.rankedPaths) {
      // Compare against every member, not only the first representative. This
      // makes deterministic families transitive without fuzzy global clustering.
      const group = groups.find((candidate) => candidate.some((member) => this.sameStructuralFamily(member, path)));
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
          normalizedFlowTokens: path.normalizedFlowTokens,
          relations: path.relations,
          terminal: path.terminal,
          familyRelation: this.familyRelation(representative, path)
        }));
        return {
          ...representative,
          branchVariantCount: 1 + alternatives.filter((path) => path.familyRelation !== 'alternate_entrance').length,
          alternateEntranceCount: alternatives.filter((path) => path.familyRelation === 'alternate_entrance').length,
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
      version: 5,
      fragmentCount: this.fragments.length,
      rawPathCount: this.rawPaths.length,
      rankedPathCount: this.rankedPaths.length,
      groupedPathCount: this.top(Number.MAX_SAFE_INTEGER).length,
      fragments: this.fragments,
      topPaths: this.top(10).map((path) => ({ ...path, rendered: this.render(path) }))
    };
  }
}
