import path from 'node:path';
import { CodeTopology } from './topology.js';

function normalize(value) {
  return String(value || '').trim();
}

function externalId(ref) {
  return `external:${encodeURIComponent(ref.relation || 'reference')}:${encodeURIComponent(ref.name || '')}`;
}

const JS_RUNTIME_CALLS = new Set([
  'Array', 'Boolean', 'BigInt', 'Date', 'Error', 'EvalError', 'Function', 'JSON', 'Map', 'Math', 'Number', 'Object',
  'Promise', 'RangeError', 'ReferenceError', 'RegExp', 'Set', 'String', 'Symbol', 'SyntaxError', 'TypeError', 'URIError',
  'WeakMap', 'WeakSet', 'console', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'eval', 'fetch',
  'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'queueMicrotask', 'setImmediate', 'setInterval', 'setTimeout',
  'clearImmediate', 'clearInterval', 'clearTimeout', 'structuredClone',
  // Common prototype/member calls. The base regex sees the leaf in obj.map(...), value.toString(...), etc.
  'at', 'concat', 'entries', 'every', 'filter', 'find', 'findIndex', 'flat', 'flatMap', 'forEach', 'from', 'has',
  'includes', 'indexOf', 'join', 'keys', 'lastIndexOf', 'map', 'match', 'pop', 'push', 'reduce', 'reduceRight',
  'replace', 'reverse', 'set', 'shift', 'slice', 'some', 'sort', 'splice', 'split', 'startsWith', 'substring',
  'substr', 'toFixed', 'toISOString', 'toLowerCase', 'toString', 'toUpperCase', 'trim', 'unshift', 'values'
]);

const PY_RUNTIME_CALLS = new Set([
  'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'filter', 'float', 'int', 'len', 'list', 'map', 'max', 'min',
  'next', 'open', 'print', 'range', 'reversed', 'round', 'set', 'sorted', 'str', 'sum', 'tuple', 'type', 'zip'
]);

function explicitXmlReferences(body) {
  const refs = [];
  const addMatches = (relation, regex) => {
    let match;
    while ((match = regex.exec(body)) && refs.length < 100) {
      const name = normalize(match[1]);
      if (name) refs.push({ name, simpleName: name.split(/[.#:/]/).filter(Boolean).at(-1) || name, relation, explicit: true });
    }
  };

  addMatches('calls', /<service-call\b[^>]*\bname=["']([^"']+)["']/g);
  addMatches('routes_to', /<transition\b[^>]*\bname=["']([^"']+)["']/g);
  addMatches('reads', /<(?:entity-find|entity-one)\b[^>]*\bentity-name=["']([^"']+)["']/g);
  addMatches('writes', /<(?:create|update|delete|store|entity-make)\b[^>]*\bentity-name=["']([^"']+)["']/g);
  return refs;
}

export class ResolvedSymbolTopology extends CodeTopology {
  constructor(options) {
    super(options);
    this.externalById = new Map();
  }

  async buildSymbolGraph() {
    this.externalById.clear();
    await super.buildSymbolGraph();

    // Normalize references after all symbols are known. Definitions remain graph nodes;
    // language/runtime mechanics are not promoted to semantic graph edges.
    for (const symbol of this.symbols) {
      symbol.references = this.filteredReferences(symbol);
    }

    // super.buildSymbolGraph built callers before filtering, so rebuild reverse edges from the cleaned references.
    this.callers.clear();
    for (const symbol of this.symbols) {
      for (const ref of symbol.references || []) {
        for (const target of this.resolveReference(ref).slice(0, 4)) {
          if (!this.callers.has(target.id)) this.callers.set(target.id, []);
          this.callers.get(target.id).push({ sourceId: symbol.id, relation: ref.relation });
        }
      }
    }
  }

  filteredReferences(symbol) {
    const ext = path.extname(symbol.sourcePath || '').toLowerCase();

    // XML has its own structural vocabulary. Do not run the generic foo(...) call interpretation over XML bodies:
    // it turns expression helpers such as remove(...) into fake enterprise dependencies.
    if (ext === '.xml') return explicitXmlReferences(symbol.body || '');

    const seen = new Set();
    const out = [];
    for (const ref of symbol.references || []) {
      const key = `${ref.relation}:${ref.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Always preserve a reference that resolves to a definition in this repository, even if its name resembles a builtin.
      if (this.resolveReference(ref).length) {
        out.push(ref);
        continue;
      }

      if (this.isRuntimeBuiltin(ref, ext)) continue;
      out.push(ref);
    }
    return out;
  }

  isRuntimeBuiltin(ref, ext) {
    if (ref?.relation !== 'calls') return false;
    const name = normalize(ref?.name);
    if (!name) return true;
    if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'].includes(ext)) return JS_RUNTIME_CALLS.has(name);
    if (ext === '.py') return PY_RUNTIME_CALLS.has(name);
    return false;
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
      if (!this.isStrongExternalReference(ref, symbol)) continue;
      const candidate = this.describeExternal(ref, symbol);
      this.externalById.set(candidate.id, candidate);
      if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
    }

    return [...byId.values()]
      .sort((a, b) => this.relationPriority(b.relation) - this.relationPriority(a.relation))
      .slice(0, 18);
  }

  isStrongExternalReference(ref, symbol) {
    // Explicit XML service/entity/route references are architectural evidence and may legitimately cross repository boundaries.
    if (ref?.explicit) return true;
    if (['routes_to', 'reads', 'writes'].includes(ref?.relation)) return true;

    // A plain unresolved foo(...) is not enough evidence to declare an enterprise dependency.
    // Qualified names are strong enough; imported-symbol resolution can be added later as another deterministic signal.
    return ref?.relation === 'calls' && this.looksQualified(ref?.name);
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
