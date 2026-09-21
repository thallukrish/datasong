import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import simpleGit from 'simple-git';

const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.java', '.kt', '.kts', '.py', '.rb', '.go', '.rs', '.cs',
  '.xml', '.gradle', '.groovy', '.sql', '.php', '.scala', '.vue', '.svelte'
]);

const MAX_FILE_BYTES = 750_000;
const MAX_SYMBOL_BODY_CHARS = 2600;
const MAX_NEIGHBORS = 18;
const MAX_SEARCH_RESULTS = 12;
const MAX_ENTRY_SYMBOLS = 24;

function normalizeRepoUrl(repoUrl) {
  return String(repoUrl || '').trim().replace(/\/$/, '');
}

function repoKey(repoUrl) {
  return crypto.createHash('sha1').update(normalizeRepoUrl(repoUrl)).digest('hex').slice(0, 16);
}

function posix(rel) {
  return rel.split(path.sep).join('/');
}

function symbolId(sourcePath, name, startLine) {
  return `symbol:${sourcePath}#${encodeURIComponent(name)}@${startLine}`;
}

function extensionLooksCode(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return true;
  const base = path.basename(filePath).toLowerCase();
  return ['dockerfile', 'makefile', 'pom.xml', 'component.xml'].includes(base);
}

async function safeStat(filePath) {
  try { return await fs.stat(filePath); } catch { return null; }
}

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function compactBody(text, max = MAX_SYMBOL_BODY_CHARS) {
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max)}\n…`;
}

function normalizeName(name) {
  return String(name || '').trim().replace(/^['"]|['"]$/g, '');
}

function simpleName(name) {
  const value = normalizeName(name);
  const pieces = value.split(/[.#:/]/).filter(Boolean);
  return pieces[pieces.length - 1] || value;
}

function extractBraceBlock(text, start) {
  const open = text.indexOf('{', start);
  if (open < 0) return { body: text.slice(start, Math.min(text.length, start + MAX_SYMBOL_BODY_CHARS)), end: Math.min(text.length, start + MAX_SYMBOL_BODY_CHARS) };
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { body: text.slice(start, i + 1), end: i + 1 };
    }
  }
  return { body: text.slice(start), end: text.length };
}

function extractIndentBlock(text, start) {
  const lines = text.slice(start).split(/\r?\n/);
  if (!lines.length) return { body: '', end: start };
  const firstIndent = (lines[0].match(/^\s*/) || [''])[0].length;
  const collected = [lines[0]];
  let chars = lines[0].length + 1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim()) {
      const indent = (line.match(/^\s*/) || [''])[0].length;
      if (indent <= firstIndent) break;
    }
    collected.push(line);
    chars += line.length + 1;
  }
  return { body: collected.join('\n'), end: start + chars };
}

function extractXmlElement(text, start, tag) {
  const openEnd = text.indexOf('>', start);
  if (openEnd < 0) return { body: text.slice(start, Math.min(text.length, start + MAX_SYMBOL_BODY_CHARS)), end: Math.min(text.length, start + MAX_SYMBOL_BODY_CHARS) };
  if (text[openEnd - 1] === '/') return { body: text.slice(start, openEnd + 1), end: openEnd + 1 };
  const close = `</${tag}>`;
  const end = text.indexOf(close, openEnd + 1);
  if (end < 0) return { body: text.slice(start, Math.min(text.length, start + MAX_SYMBOL_BODY_CHARS)), end: Math.min(text.length, start + MAX_SYMBOL_BODY_CHARS) };
  return { body: text.slice(start, end + close.length), end: end + close.length };
}

function extractNamedXmlSymbols(text, sourcePath) {
  const symbols = [];
  const pattern = /<(service|transition|screen|actions|script|condition)\b([^>]*)>/g;
  let match;
  while ((match = pattern.exec(text))) {
    const tag = match[1];
    const attrs = match[2] || '';
    const attr = (name) => (attrs.match(new RegExp(`${name}=["']([^"']+)["']`)) || [])[1] || '';
    const verb = attr('verb');
    const noun = attr('noun');
    const explicit = attr('name') || attr('id');
    let name = explicit;
    if (tag === 'service' && (verb || noun)) name = [verb, noun].filter(Boolean).join('#');
    if (!name) continue;
    const block = extractXmlElement(text, match.index, tag);
    const startLine = lineNumberAt(text, match.index);
    const endLine = lineNumberAt(text, block.end);
    symbols.push({
      id: symbolId(sourcePath, name, startLine),
      name,
      simpleName: simpleName(name),
      symbolKind: tag,
      signature: `<${tag} ${attrs.trim()}>`,
      sourcePath,
      startLine,
      endLine,
      body: block.body
    });
  }
  return symbols;
}

function extractCodeSymbols(text, sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === '.xml') return extractNamedXmlSymbols(text, sourcePath);

  const symbols = [];
  const patterns = [];
  if (ext === '.py') {
    patterns.push({ kind: 'function', regex: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)\s*:/gm, indent: true });
  } else {
    patterns.push(
      { kind: 'function', regex: /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g },
      { kind: 'function', regex: /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g },
      { kind: 'method', regex: /(?:^|\n)\s*(?:public|private|protected|static|final|synchronized|override|open|internal|suspend|abstract|native|transient|inline|operator|infix|tailrec|external|async|virtual|sealed|partial|unsafe|new|readonly|\s)*\s*(?:[\w<>\[\],.?]+\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?:throws\s+[^{]+)?\{/g }
    );
  }

  const seen = new Set();
  for (const spec of patterns) {
    let match;
    while ((match = spec.regex.exec(text))) {
      const name = match[1];
      if (!name || ['if', 'for', 'while', 'switch', 'catch'].includes(name)) continue;
      const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
      const key = `${name}:${start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const block = spec.indent ? extractIndentBlock(text, start) : extractBraceBlock(text, start);
      const startLine = lineNumberAt(text, start);
      const endLine = lineNumberAt(text, block.end);
      symbols.push({
        id: symbolId(sourcePath, name, startLine),
        name,
        simpleName: simpleName(name),
        symbolKind: spec.kind,
        signature: match[0].trim().slice(0, 280),
        sourcePath,
        startLine,
        endLine,
        body: block.body
      });
    }
  }
  return symbols;
}

function collectReferences(symbol) {
  const body = symbol.body || '';
  const refs = [];
  const add = (name, relation) => {
    const value = normalizeName(name);
    if (!value || value === symbol.name || value === symbol.simpleName) return;
    refs.push({ name: value, simpleName: simpleName(value), relation });
  };

  let match;
  const callPattern = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  while ((match = callPattern.exec(body)) && refs.length < 80) {
    if (!['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'typeof'].includes(match[1])) add(match[1], 'calls');
  }

  const xmlPatterns = [
    { relation: 'calls', regex: /<service-call\b[^>]*\bname=["']([^"']+)["']/g },
    { relation: 'routes_to', regex: /<transition\b[^>]*\bname=["']([^"']+)["']/g },
    { relation: 'reads', regex: /<(?:entity-find|entity-one)\b[^>]*\bentity-name=["']([^"']+)["']/g },
    { relation: 'writes', regex: /<(?:create|update|delete|store|entity-make)\b[^>]*\bentity-name=["']([^"']+)["']/g }
  ];
  for (const spec of xmlPatterns) {
    while ((match = spec.regex.exec(body)) && refs.length < 100) add(match[1], spec.relation);
  }
  return refs;
}

export class CodeTopology {
  constructor({ cacheRoot }) {
    this.cacheRoot = cacheRoot;
    this.repoDir = null;
    this.repoUrl = null;
    this.commit = null;
    this.files = [];
    this.symbols = [];
    this.symbolById = new Map();
    this.nameIndex = new Map();
    this.callers = new Map();
  }

  async prepare(repoUrl) {
    this.repoUrl = normalizeRepoUrl(repoUrl);
    await fs.mkdir(this.cacheRoot, { recursive: true });
    this.repoDir = path.join(this.cacheRoot, repoKey(this.repoUrl));
    const gitDir = path.join(this.repoDir, '.git');
    if (!(await safeStat(gitDir))) {
      await fs.rm(this.repoDir, { recursive: true, force: true });
      await simpleGit().clone(this.repoUrl, this.repoDir, ['--depth', '1']);
    } else {
      const git = simpleGit(this.repoDir);
      await git.fetch(['origin', '--depth', '1']);
      await git.reset(['--hard', 'FETCH_HEAD']);
    }

    const git = simpleGit(this.repoDir);
    this.commit = (await git.revparse(['HEAD'])).trim();
    const tracked = (await git.raw(['ls-files'])).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    this.files = tracked.filter(extensionLooksCode);

    await this.buildSymbolGraph();

    return {
      repoUrl: this.repoUrl,
      commit: this.commit,
      searchableFiles: this.files.length,
      searchableSymbols: this.symbols.length,
      root: this.repositoryOrientation()
    };
  }

  async buildSymbolGraph() {
    this.symbols = [];
    this.symbolById.clear();
    this.nameIndex.clear();
    this.callers.clear();

    for (const rel of this.files) {
      const abs = path.join(this.repoDir, rel);
      const stat = await safeStat(abs);
      if (!stat || !stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      const text = await fs.readFile(abs, 'utf8').catch(() => '');
      if (!text) continue;
      const extracted = extractCodeSymbols(text, rel);
      for (const symbol of extracted) {
        symbol.references = collectReferences(symbol);
        this.symbols.push(symbol);
        this.symbolById.set(symbol.id, symbol);
        for (const key of new Set([symbol.name.toLowerCase(), symbol.simpleName.toLowerCase()])) {
          if (!this.nameIndex.has(key)) this.nameIndex.set(key, []);
          this.nameIndex.get(key).push(symbol.id);
        }
      }
    }

    for (const symbol of this.symbols) {
      for (const ref of symbol.references) {
        for (const target of this.resolveReference(ref).slice(0, 4)) {
          if (!this.callers.has(target.id)) this.callers.set(target.id, []);
          this.callers.get(target.id).push({ sourceId: symbol.id, relation: ref.relation });
        }
      }
    }
  }

  repositoryOrientation() {
    const entrySymbols = this.entrySymbols().slice(0, MAX_ENTRY_SYMBOLS).map((symbol) => this.describeCandidate(symbol, 'entrypoint', 'local symbol entry point'));
    return {
      id: 'repo:symbol-index',
      path: '.',
      kind: 'symbol_index',
      summary: `Repository symbol index: ${this.symbols.length} locally parsed symbols across ${this.files.length} code files.`,
      excerpt: '',
      neighbors: entrySymbols
    };
  }

  entrySymbols() {
    return [...this.symbols].sort((a, b) => this.entryPriority(b) - this.entryPriority(a));
  }

  entryPriority(symbol) {
    let score = 0;
    const name = `${symbol.name} ${symbol.sourcePath}`.toLowerCase();
    const incoming = (this.callers.get(symbol.id) || []).length;
    if (incoming === 0) score += 25;
    if (['transition', 'screen', 'service'].includes(symbol.symbolKind)) score += 35;
    if (/(route|handler|controller|screen|transition|service|process|submit|create|place|checkout|order|approve|import|export|run|execute)/.test(name)) score += 20;
    if (/(test|spec|mock|fixture|util|helper)/.test(name)) score -= 15;
    score += Math.min(15, symbol.references.length);
    return score;
  }

  async observe(idOrPath) {
    const raw = String(idOrPath || '');
    if (raw === '.' || raw === 'repo:symbol-index') return this.repositoryOrientation();
    const symbol = this.symbolById.get(raw);
    if (!symbol) return { id: raw, path: raw, kind: 'missing', summary: 'Symbol no longer exists.', excerpt: '', neighbors: [] };

    const neighbors = this.symbolNeighbors(symbol);
    return {
      id: symbol.id,
      path: `${symbol.sourcePath}#${symbol.name}`,
      kind: 'symbol',
      symbolKind: symbol.symbolKind,
      symbolName: symbol.name,
      signature: symbol.signature,
      sourcePath: symbol.sourcePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      summary: `${symbol.symbolKind} ${symbol.name} in ${symbol.sourcePath}:${symbol.startLine}-${symbol.endLine}`,
      excerpt: compactBody(symbol.body),
      neighbors
    };
  }

  symbolNeighbors(symbol) {
    const candidates = new Map();
    const add = (target, relation, hint) => {
      if (!target || target.id === symbol.id) return;
      const current = candidates.get(target.id);
      const rank = this.relationPriority(relation);
      if (!current || rank > this.relationPriority(current.relation)) candidates.set(target.id, this.describeCandidate(target, relation, hint));
    };

    for (const ref of symbol.references) {
      for (const target of this.resolveReference(ref).slice(0, 4)) add(target, ref.relation, `reference ${ref.name}`);
    }

    for (const caller of this.callers.get(symbol.id) || []) {
      const source = this.symbolById.get(caller.sourceId);
      add(source, 'called_by', `caller of ${symbol.name}`);
    }

    return [...candidates.values()]
      .sort((a, b) => this.relationPriority(b.relation) - this.relationPriority(a.relation))
      .slice(0, MAX_NEIGHBORS);
  }

  relationPriority(relation) {
    return ({ calls: 100, routes_to: 95, writes: 90, reads: 85, called_by: 75, entrypoint: 55, search: 45 }[relation] || 20);
  }

  resolveReference(ref) {
    const exact = this.nameIndex.get(ref.name.toLowerCase()) || [];
    const simple = this.nameIndex.get(ref.simpleName.toLowerCase()) || [];
    return [...new Set([...exact, ...simple])].map((id) => this.symbolById.get(id)).filter(Boolean);
  }

  describeCandidate(symbol, relation, hint = '') {
    return {
      id: symbol.id,
      path: `${symbol.sourcePath}#${symbol.name}`,
      kind: 'symbol',
      symbolKind: symbol.symbolKind,
      relation,
      label: symbol.name,
      hint: `${hint}${hint ? '; ' : ''}${symbol.signature}`.slice(0, 260),
      sourcePath: symbol.sourcePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine
    };
  }

  async search(query, limit = MAX_SEARCH_RESULTS) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
    const scored = [];
    for (const symbol of this.symbols) {
      const haystack = `${symbol.name} ${symbol.signature} ${symbol.sourcePath}`.toLowerCase();
      const body = (symbol.body || '').toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += 5;
        else if (body.includes(term)) score += 1;
      }
      if (score > 0) scored.push({ symbol, score });
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ symbol, score }) => this.describeCandidate(symbol, 'search', `semantic/code search score ${score}`));
  }
}
