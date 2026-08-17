import path from 'node:path';
import { CodeTopology } from './topology.js';

function normalize(value) {
  return String(value || '').trim();
}

function externalId(ref) {
  return `external:${encodeURIComponent(ref.relation || 'reference')}:${encodeURIComponent(ref.name || '')}`;
}

export class ResolvedSymbolTopology extends CodeTopology {
  constructor(options) {
    super(options);
    this.externalById = new Map();
  }

  async buildSymbolGraph() {
    this.externalById.clear();
    await super.buildSymbolGraph();
  }

  resolveReference(ref) {
    const qualified = this.resolveQualifiedService(ref);
    if (qualified.length) return qualified;

    // For qualified references, do not immediately degrade to a loose simple-name
    // match. That is how place#Order ended up wandering into unrelated symbols.
    if (this.looksQualified(ref?.name)) {
      const exact = this.resolveQualifiedByPathAndName(ref);
      if (exact.length) return exact;
      return [];
    }

    return super.resolveReference(ref);
  }

  looksQualified(name) {
    const value = normalize(name);
    return value.includes('.') || value.includes('/') || value.includes(':');
  }

  resolveQualifiedService(ref) {
    const value = normalize(ref?.name);
    if (!value.includes('#') || !value.includes('.')) return [];

    const hash = value.lastIndexOf('#');
    const beforeHash = value.slice(0, hash);
    const noun = value.slice(hash + 1);
    const parts = beforeHash.split('.').filter(Boolean);
    if (parts.length < 2) return [];

    const verb = parts.pop();
    const fileStem = parts.pop();
    const namespace = parts;
    const localName = `${verb}#${noun}`;
    const wantedFile = `${fileStem}.xml`.toLowerCase();
    const namespaceSuffix = [...namespace, `${fileStem}.xml`].join('/').toLowerCase();

    const matches = this.symbols
      .filter((symbol) => symbol.symbolKind === 'service')
      .filter((symbol) => symbol.name.toLowerCase() === localName.toLowerCase())
      .filter((symbol) => path.posix.basename(symbol.sourcePath).toLowerCase() === wantedFile)
      .map((symbol) => {
        const source = symbol.sourcePath.toLowerCase();
        let score = 10;
        if (namespaceSuffix && source.endsWith(namespaceSuffix)) score += 100;
        else if (namespace.length && namespace.every((segment) => source.includes(`/${segment.toLowerCase()}/`) || source.startsWith(`${segment.toLowerCase()}/`))) score += 25;
        return { symbol, score };
      })
      .sort((a, b) => b.score - a.score);

    return matches.map((entry) => entry.symbol);
  }

  resolveQualifiedByPathAndName(ref) {
    const value = normalize(ref?.name);
    if (!value) return [];

    const pieces = value.split(/[.:/]/).filter(Boolean);
    const leaf = pieces[pieces.length - 1] || value;
    const parent = pieces.length > 1 ? pieces[pieces.length - 2].toLowerCase() : '';

    return this.symbols.filter((symbol) => {
      if (symbol.name.toLowerCase() !== leaf.toLowerCase() && symbol.simpleName.toLowerCase() !== leaf.toLowerCase()) return false;
      if (!parent) return true;
      const source = symbol.sourcePath.toLowerCase();
      return source.includes(`/${parent}/`) || path.posix.basename(source).startsWith(parent);
    });
  }

  symbolNeighbors(symbol) {
    const resolved = super.symbolNeighbors(symbol);
    const byId = new Map(resolved.map((candidate) => [candidate.id, candidate]));

    for (const ref of symbol.references || []) {
      if (this.resolveReference(ref).length) continue;
      if (!['calls', 'routes_to', 'reads', 'writes'].includes(ref.relation)) continue;
      const candidate = this.describeExternal(ref, symbol);
      this.externalById.set(candidate.id, candidate);
      if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
    }

    return [...byId.values()]
      .sort((a, b) => this.relationPriority(b.relation) - this.relationPriority(a.relation))
      .slice(0, 18);
  }

  describeExternal(ref, sourceSymbol) {
    const id = externalId(ref);
    return {
      id,
      path: ref.name,
      kind: 'external_boundary',
      symbolKind: 'external',
      relation: ref.relation,
      label: ref.name,
      hint: `Unresolved ${ref.relation} from ${sourceSymbol.name}; no local definition found`,
      external: true,
      referenceName: ref.name,
      sourceSymbolId: sourceSymbol.id
    };
  }

  async observe(idOrPath) {
    const raw = String(idOrPath || '');
    const external = this.externalById.get(raw);
    if (external) {
      return {
        ...external,
        summary: `External/unresolved ${external.relation}: ${external.referenceName}`,
        excerpt: '',
        neighbors: []
      };
    }
    return super.observe(idOrPath);
  }
}
