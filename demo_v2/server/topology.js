import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import simpleGit from 'simple-git';
import { createIndexesFromRows } from 'pal-executor-lib/indexing';
import { analyzePythonRepository } from './languages/python/adapter.js';

const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.java', '.kt', '.kts', '.py', '.rb', '.go', '.rs', '.cs',
  '.xml', '.gradle', '.groovy', '.sql', '.php', '.scala', '.vue', '.svelte'
]);

const MAX_FILE_BYTES = 750_000;
const MAX_SYMBOL_BODY_CHARS = 2600;
const MAX_NEIGHBORS = 18;
const MAX_SEARCH_RESULTS = 12;
const MAX_ENTRY_SYMBOLS = 24;
const MAX_README_CHARS = 5000;
const CONSTRUCT_INDEX_SCHEMA_VERSION = 1;
const PYTHON_ANALYZER_VERSION = 6;

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

function pythonModuleName(sourcePath) {
  const normalized = String(sourcePath || '').replace(/\\/g, '/');
  const withoutExt = normalized.toLowerCase().endsWith('.py') ? normalized.slice(0, -3) : normalized;
  const parts = withoutExt.split('/').filter(Boolean);
  if (parts.at(-1) === '__init__') parts.pop();
  return parts.join('.');
}

function pythonSourcePathForModule(moduleName, files=[]) {
  const wanted = String(moduleName || '').replace(/^\.+|\.+$/g, '');
  if (!wanted) return '';
  const direct = wanted.replace(/\./g, '/') + '.py';
  const init = wanted.replace(/\./g, '/') + '/__init__.py';
  const set = new Set(files.map((file) => String(file).replace(/\\/g, '/')));
  if (set.has(direct)) return direct;
  if (set.has(init)) return init;
  return '';
}

function resolveRelativePythonModule(sourcePath, level, importedModule) {
  if (!level) return String(importedModule || '').replace(/^\.+|\.+$/g, '');
  const current = pythonModuleName(sourcePath);
  const packageParts = current.split('.').slice(0, -1);
  const keep = Math.max(0, packageParts.length - Number(level || 0) + 1);
  return [...packageParts.slice(0, keep), String(importedModule || '').replace(/^\.+|\.+$/g, '')]
    .filter(Boolean)
    .join('.');
}

function pythonImportsFromText(text, sourcePath, files=[]) {
  const targets = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    let match = line.match(/^\s*import\s+(.+)$/);
    if (match) {
      for (const spec of match[1].split(',')) {
        const moduleName = spec.trim().split(/\s+as\s+/i)[0].trim();
        const target = pythonSourcePathForModule(moduleName, files);
        if (target) targets.add(target);
      }
      continue;
    }
    match = line.match(/^\s*from\s+(\.*)([A-Za-z_][\w.]*)?\s+import\s+/);
    if (!match) continue;
    const level = (match[1] || '').length;
    const moduleName = resolveRelativePythonModule(sourcePath, level, match[2] || '');
    const target = pythonSourcePathForModule(moduleName, files);
    if (target) targets.add(target);
  }
  return [...targets];
}

async function sha1File(filePath) {
  try {
    const data = await fs.readFile(filePath);
    return crypto.createHash('sha1').update(data).digest('hex');
  } catch {
    return '';
  }
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
    this.repositoryReadme = '';
    this.targetCommit = '';
    this.constructIndex = [];
    this.constructIndexVersion = 0;
    this.constructIndexMeta = null;
    this.pythonAnalysis = null;
    this.codeStructureFacts = [];
    this.codeStructureRows = [];
    this.palUniqueIndex = null;
    this.palValuesIndex = null;
    this.forceConstructIndexRebuild = false;
  }

  async prepareIndexOnly(repoUrl) {
    const startedAt=Date.now();
    const stage=(name,started,extra='')=>console.log(`[repo-index] ${name} ${Date.now()-started}ms${extra?' '+extra:''}`);

    this.repoUrl = normalizeRepoUrl(repoUrl);
    await fs.mkdir(this.cacheRoot, { recursive: true });
    this.repoDir = path.join(this.cacheRoot, repoKey(this.repoUrl));
    const gitDir = path.join(this.repoDir, '.git');
    const requestedCommit = String(this.targetCommit || '').trim();

    console.log(`[repo-index] START repo=${this.repoUrl} revision=${requestedCommit||'HEAD'} force=${this.forceConstructIndexRebuild?'yes':'no'}`);

    let t=Date.now();
    if (!(await safeStat(gitDir))) {
      console.log('[repo-index] cloning repository');
      await fs.rm(this.repoDir, { recursive: true, force: true });
      await simpleGit().clone(this.repoUrl, this.repoDir, ['--depth', '1']);
      stage('clone',t);
    } else {
      stage('reuse-local-checkout',t);
    }

    const git = simpleGit(this.repoDir);
    t=Date.now();
    console.log(`[repo-index] fetching revision ${requestedCommit||'HEAD'}`);
    if (requestedCommit) {
      await git.fetch(['origin', requestedCommit, '--depth', '1']);
      await git.reset(['--hard', 'FETCH_HEAD']);
    } else {
      await git.fetch(['origin', '--depth', '1']);
      await git.reset(['--hard', 'FETCH_HEAD']);
    }
    this.commit = (await git.revparse(['HEAD'])).trim();
    stage('fetch-checkout',t,`commit=${this.commit}`);

    const requestedLooksLikeCommit = /^[0-9a-f]{7,40}$/i.test(requestedCommit);
    if (requestedLooksLikeCommit && !this.commit.toLowerCase().startsWith(requestedCommit.toLowerCase())) {
      throw new Error(`Prepared revision ${this.commit} does not match requested commit ${requestedCommit}.`);
    }

    t=Date.now();
    const tracked = (await git.raw(['ls-files'])).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    this.files = tracked.filter(extensionLooksCode);
    const readmeRel = tracked.find((rel) => /^readme(?:\.[^/]+)?$/i.test(rel));
    this.repositoryReadme = readmeRel ? (await fs.readFile(path.join(this.repoDir, readmeRel), 'utf8').catch(() => '')).slice(0, MAX_README_CHARS) : '';
    stage('enumerate-files',t,`tracked=${tracked.length} code=${this.files.length} python=${this.files.filter(file=>String(file).toLowerCase().endsWith('.py')).length}`);

    t=Date.now();
    console.log('[repo-index] building structural CSV index');
    await this.buildConstructIndex();
    stage('structural-csv',t,`rows=${this.codeStructureRows.length} reused=${this.constructIndexMeta?.reused?'yes':'no'}`);

    console.log(`[repo-index] DONE ${Date.now()-startedAt}ms commit=${this.commit} rows=${this.codeStructureRows.length}`);
    return {
      repoUrl:this.repoUrl,
      commit:this.commit,
      searchableFiles:this.files.length,
      searchableSymbols:0,
      constructIndex:this.constructIndexMeta ? {
        status:this.constructIndexMeta.status,
        language:this.constructIndexMeta.language,
        recordCount:this.constructIndexMeta.recordCount,
        reused:!!this.constructIndexMeta.reused,
        commit:this.constructIndexMeta.commit,
        schemaVersion:this.constructIndexMeta.schemaVersion,
        analyzerVersion:this.constructIndexMeta.analyzerVersion,
        csvPath:this.constructIndexMeta.csvPath||'',
        uniqueIndexPath:this.constructIndexMeta.uniqueIndexPath||'',
        valuesIndexPath:this.constructIndexMeta.valuesIndexPath||'',
        csvRowCount:Number(this.constructIndexMeta.csvRowCount||0),
        incremental:!!this.constructIndexMeta.incremental,
        incrementalFrom:this.constructIndexMeta.incrementalFrom||'',
        affectedFiles:Array.isArray(this.constructIndexMeta.affectedFiles)?this.constructIndexMeta.affectedFiles:[]
      } : null,
      indexOnly:true,
      readme:this.repositoryReadme
    };
  }

  async prepare(repoUrl) {
    this.repoUrl = normalizeRepoUrl(repoUrl);
    await fs.mkdir(this.cacheRoot, { recursive: true });
    this.repoDir = path.join(this.cacheRoot, repoKey(this.repoUrl));
    const gitDir = path.join(this.repoDir, '.git');
    const requestedCommit = String(this.targetCommit || '').trim();
    if (!(await safeStat(gitDir))) {
      await fs.rm(this.repoDir, { recursive: true, force: true });
      await simpleGit().clone(this.repoUrl, this.repoDir, ['--depth', '1']);
    }

    const git = simpleGit(this.repoDir);
    if (requestedCommit) {
      await git.fetch(['origin', requestedCommit, '--depth', '1']);
      await git.reset(['--hard', 'FETCH_HEAD']);
    } else {
      await git.fetch(['origin', '--depth', '1']);
      await git.reset(['--hard', 'FETCH_HEAD']);
    }

    this.commit = (await git.revparse(['HEAD'])).trim();
    const requestedLooksLikeCommit = /^[0-9a-f]{7,40}$/i.test(requestedCommit);
    if (requestedLooksLikeCommit && !this.commit.toLowerCase().startsWith(requestedCommit.toLowerCase())) {
      throw new Error(`Prepared revision ${this.commit} does not match requested commit ${requestedCommit}.`);
    }
    const tracked = (await git.raw(['ls-files'])).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    this.files = tracked.filter(extensionLooksCode);
    const readmeRel = tracked.find((rel) => /^readme(?:\.[^/]+)?$/i.test(rel));
    this.repositoryReadme = readmeRel ? (await fs.readFile(path.join(this.repoDir, readmeRel), 'utf8').catch(() => '')).slice(0, MAX_README_CHARS) : '';

    await this.buildSymbolGraph();
    await this.buildConstructIndex();

    return {
      repoUrl: this.repoUrl,
      commit: this.commit,
      searchableFiles: this.files.length,
      searchableSymbols: this.symbols.length,
      constructIndex: this.constructIndexMeta ? {
        status: this.constructIndexMeta.status,
        language: this.constructIndexMeta.language,
        recordCount: this.constructIndexMeta.recordCount,
        reused: !!this.constructIndexMeta.reused,
        commit: this.constructIndexMeta.commit,
        schemaVersion: this.constructIndexMeta.schemaVersion,
        analyzerVersion: this.constructIndexMeta.analyzerVersion,
        csvPath: this.constructIndexMeta.csvPath || '',
        uniqueIndexPath: this.constructIndexMeta.uniqueIndexPath || '',
        valuesIndexPath: this.constructIndexMeta.valuesIndexPath || '',
        csvRowCount: Number(this.constructIndexMeta.csvRowCount || 0)
      } : null,
      root: this.repositoryOrientation(),
      readme: this.repositoryReadme
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
        // CodeTopology only emits executable code/workflow constructs. Other
        // semantic nodes added by higher layers must opt into executability.
        symbol.executable = true;
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

  codeStructureMetaPath(language='python') {
    const revision = String(this.commit || '').trim();
    if (!revision || !this.repoUrl) return '';
    return path.join(
      this.cacheRoot,
      'code-structural-csv',
      repoKey(this.repoUrl),
      revision,
      `${language}.meta.json`
    );
  }

  codeStructureCsvPath(language='python') {
    const revision = String(this.commit || '').trim();
    if (!revision || !this.repoUrl) return '';
    return path.join(
      this.cacheRoot,
      'code-structural-csv',
      repoKey(this.repoUrl),
      revision,
      `${language}.csv`
    );
  }

  codeStructureUniqueIndexPath(language='python') {
    const csvPath = this.codeStructureCsvPath(language);
    return csvPath ? csvPath.replace(/\.csv$/i, '.uniqueIndex.json') : '';
  }

  codeStructureValuesIndexPath(language='python') {
    const csvPath = this.codeStructureCsvPath(language);
    return csvPath ? csvPath.replace(/\.csv$/i, '.valuesIndex.json') : '';
  }

  buildPalIndexes(rows=[]) {
    return createIndexesFromRows(rows, {
      headers:['row','file','line_range','type','name','parent','children','callers','callees'],
      excludeColumns:['row'],
      multiValueColumns:['children','callers','callees']
    });
  }

  async persistPalIndexes({ language='python', rows=[] }={}) {
    const uniqueIndexPath = this.codeStructureUniqueIndexPath(language);
    const valuesIndexPath = this.codeStructureValuesIndexPath(language);
    if (!uniqueIndexPath || !valuesIndexPath) return { uniqueIndexPath:'', valuesIndexPath:'' };

    const { uniqueIndex, valuesIndex } = this.buildPalIndexes(rows);
    await fs.mkdir(path.dirname(uniqueIndexPath), { recursive:true });

    const writeAtomic = async (targetPath, payload) => {
      const tempPath = `${targetPath}.${process.pid}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(payload), 'utf8');
      await fs.rm(targetPath, { force:true });
      await fs.rename(tempPath, targetPath);
    };

    await writeAtomic(uniqueIndexPath, uniqueIndex);
    await writeAtomic(valuesIndexPath, valuesIndex);
    this.palUniqueIndex = uniqueIndex;
    this.palValuesIndex = valuesIndex;
    return { uniqueIndexPath, valuesIndexPath };
  }

  async loadPalIndexes(language='python') {
    const uniqueIndexPath = this.codeStructureUniqueIndexPath(language);
    const valuesIndexPath = this.codeStructureValuesIndexPath(language);
    if (!uniqueIndexPath || !valuesIndexPath) return false;
    try {
      const [uniqueIndex, valuesIndex] = await Promise.all([
        fs.readFile(uniqueIndexPath, 'utf8').then(JSON.parse),
        fs.readFile(valuesIndexPath, 'utf8').then(JSON.parse)
      ]);
      this.palUniqueIndex = uniqueIndex;
      this.palValuesIndex = valuesIndex;
      return true;
    } catch {
      this.palUniqueIndex = null;
      this.palValuesIndex = null;
      return false;
    }
  }

  materializeCodeStructureRows(codeFacts=[], analysis=null) {
    const facts = (Array.isArray(codeFacts) ? codeFacts : [])
      .filter((fact) => fact?.factId && fact?.sourcePath)
      .slice()
      .sort((a, b) =>
        String(a.sourcePath).localeCompare(String(b.sourcePath)) ||
        Number(a.ordinal || 0) - Number(b.ordinal || 0) ||
        Number(a.startLine || 0) - Number(b.startLine || 0) ||
        String(a.factId).localeCompare(String(b.factId))
      );

    const rowByFactId = new Map(facts.map((fact, index) => [fact.factId, index + 1]));
    const rows = facts.map((fact, index) => {
      const start = Number(fact.startLine || 0);
      const end = Number(fact.endLine || start);
      const children = (Array.isArray(fact.childFactIds) ? fact.childFactIds : [])
        .map((id) => rowByFactId.get(id))
        .filter(Boolean)
        .sort((a, b) => a - b);
      return {
        row: index + 1,
        file: String(fact.sourcePath || ''),
        line_range: start === end ? String(start) : `${start}-${end}`,
        type: String(fact.type || ''),
        name: String(fact.name || ''),
        parent: rowByFactId.get(fact.parentFactId) || '',
        children: JSON.stringify(children.map(String)),
        callers: '[]',
        callees: '[]'
      };
    });

    const functionRowByLocation = new Map();
    for (const row of rows) {
      if (row.type !== 'function') continue;
      const start = Number(String(row.line_range).split('-')[0] || 0);
      functionRowByLocation.set(`${row.file}:${start}`, row.row);
    }

    const symbols = Array.isArray(analysis?.symbols) ? analysis.symbols : [];
    const symbolById = new Map(symbols.filter((symbol) => symbol?.id).map((symbol) => [symbol.id, symbol]));
    const callers = new Map();
    const callees = new Map();
    const addRelation = (map, from, to) => {
      if (!from || !to) return;
      if (!map.has(from)) map.set(from, new Set());
      map.get(from).add(to);
    };

    for (const symbol of symbols) {
      const sourceRow = functionRowByLocation.get(`${symbol.sourcePath}:${Number(symbol.startLine || 0)}`);
      if (!sourceRow) continue;
      for (const ref of Array.isArray(symbol.references) ? symbol.references : []) {
        if (!ref?.targetSymbolId) continue;
        const target = symbolById.get(ref.targetSymbolId);
        if (!target) continue;
        const targetRow = functionRowByLocation.get(`${target.sourcePath}:${Number(target.startLine || 0)}`);
        if (!targetRow) continue;
        addRelation(callees, sourceRow, targetRow);
        addRelation(callers, targetRow, sourceRow);
      }
    }

    for (const row of rows) {
      row.callers = JSON.stringify([...(callers.get(row.row) || [])].sort((a, b) => a - b).map(String));
      row.callees = JSON.stringify([...(callees.get(row.row) || [])].sort((a, b) => a - b).map(String));
    }
    return rows;
  }

  serializeCodeStructureCsv(rows=[]) {
    const columns = ['row', 'file', 'line_range', 'type', 'name', 'parent', 'children', 'callers', 'callees'];
    const cell = (value) => {
      const text = String(value ?? '');
      return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    return [
      columns.join(','),
      ...(Array.isArray(rows) ? rows : []).map((row) => columns.map((column) => cell(row?.[column])).join(','))
    ].join('\n') + '\n';
  }

  parseCodeStructureCsv(text='') {
    const records = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const pushCell = () => { row.push(cell); cell = ''; };
    const pushRow = () => {
      pushCell();
      if (row.some((value) => value !== '')) records.push(row);
      row = [];
    };

    const input = String(text || '');
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (quoted) {
        if (ch === '"' && input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
        continue;
      }
      if (ch === '"') quoted = true;
      else if (ch === ',') pushCell();
      else if (ch === '\n') pushRow();
      else if (ch !== '\r') cell += ch;
    }
    if (cell.length || row.length) pushRow();
    if (!records.length) return [];

    const headers = records.shift();
    return records.map((values) => {
      const out = {};
      headers.forEach((header, index) => { out[header] = values[index] ?? ''; });
      out.row = Number(out.row || 0);
      out.parent = out.parent === '' ? '' : Number(out.parent || 0);
      return out;
    });
  }

  async persistCodeStructureCsv({ language='python', rows=[] }={}) {
    const csvPath = this.codeStructureCsvPath(language);
    if (!csvPath) return '';
    await fs.mkdir(path.dirname(csvPath), { recursive: true });
    const tempPath = `${csvPath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, this.serializeCodeStructureCsv(rows), 'utf8');
    await fs.rm(csvPath, { force:true });
    await fs.rename(tempPath, csvPath);
    return csvPath;
  }

  async loadCodeStructureCsv(language='python') {
    const csvPath = this.codeStructureCsvPath(language);
    if (!csvPath) return [];
    try {
      const text = await fs.readFile(csvPath, 'utf8');
      return this.parseCodeStructureCsv(text);
    } catch {
      return [];
    }
  }

  async pythonSnapshotInputs(pythonFiles=[]) {
    const fileHashes = {};
    const importGraph = {};
    for (const rel of pythonFiles) {
      const abs = path.join(this.repoDir, rel);
      fileHashes[rel] = await sha1File(abs);
      const source = await fs.readFile(abs, 'utf8').catch(() => '');
      importGraph[rel] = pythonImportsFromText(source, rel, pythonFiles);
    }
    return { fileHashes, importGraph };
  }

  async loadCodeStructureCache({ language='python', analyzerVersion=0 }={}) {
    const metaPath = this.codeStructureMetaPath(language);
    const csvPath = this.codeStructureCsvPath(language);
    if (!metaPath || !csvPath) return false;
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      const valid =
        meta?.status === 'complete' &&
        meta?.commit === this.commit &&
        Number(meta?.schemaVersion || 0) === CONSTRUCT_INDEX_SCHEMA_VERSION &&
        Number(meta?.analyzerVersion || 0) === Number(analyzerVersion || 0);
      if (!valid) return false;

      const rows = await this.loadCodeStructureCsv(language);
      if (!rows.length && Number(meta?.csvRowCount || 0) > 0) return false;
      if (!(await this.loadPalIndexes(language))) return false;

      this.constructIndex = [];
      this.pythonAnalysis = null;
      this.codeStructureFacts = [];
      this.codeStructureRows = rows;
      this.constructIndexVersion = Number(meta.analyzerVersion || 0);
      this.constructIndexMeta = { ...meta, cachePath:metaPath, metaPath, csvPath, uniqueIndexPath:this.codeStructureUniqueIndexPath(language), valuesIndexPath:this.codeStructureValuesIndexPath(language), csvRowCount:rows.length, reused:true };
      return true;
    } catch {
      return false;
    }
  }

  async persistCodeStructureMeta({ language='python', analyzerVersion=0, rowCount=0, fileHashes={}, importGraph={} }={}) {
    const metaPath = this.codeStructureMetaPath(language);
    if (!metaPath) return '';
    const metadata = {
      status:'complete',
      repoUrl:this.repoUrl,
      requestedRevision:String(this.targetCommit || ''),
      commit:this.commit,
      language,
      schemaVersion:CONSTRUCT_INDEX_SCHEMA_VERSION,
      analyzerVersion:Number(analyzerVersion || 0),
      recordCount:Number(rowCount || 0),
      csvRowCount:Number(rowCount || 0),
      fileHashes,
      importGraph,
      createdAt:new Date().toISOString()
    };
    await fs.mkdir(path.dirname(metaPath), { recursive:true });
    const tempPath = `${metaPath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(metadata), 'utf8');
    await fs.rm(metaPath, { force:true });
    await fs.rename(tempPath, metaPath);

    // Remove the pre-CSV snapshot format if it exists. It duplicated codeFacts
    // and AST analysis beside python.csv and could be tens of megabytes.
    const legacySnapshotPath = path.join(path.dirname(metaPath), `${language}.json`);
    await fs.rm(legacySnapshotPath, { force:true });

    return metaPath;
  }

  async buildConstructIndex() {
    this.constructIndex = [];
    this.constructIndexVersion = 0;
    this.constructIndexMeta = null;
    this.pythonAnalysis = null;
    this.codeStructureFacts = [];
    this.codeStructureRows = [];
    this.palUniqueIndex = null;
    this.palValuesIndex = null;
    const pythonFiles = this.files.filter((file) => String(file).toLowerCase().endsWith('.py'));
    if (!pythonFiles.length) return;

    if (!this.forceConstructIndexRebuild && await this.loadCodeStructureCache({ language:'python', analyzerVersion:PYTHON_ANALYZER_VERSION })) {
      console.log(`[repo-index] cache hit language=python rows=${this.codeStructureRows.length}`);
      return;
    }

    try {
      const { fileHashes, importGraph } = await this.pythonSnapshotInputs(pythonFiles);
      console.log(`[repo-index] python AST full analyze files=${pythonFiles.length}`);
      const analyzeStarted = Date.now();
      const analyzed = await analyzePythonRepository({ repoDir:this.repoDir, files:pythonFiles });
      console.log(`[repo-index] python AST complete ${Date.now()-analyzeStarted}ms facts=${Array.isArray(analyzed?.codeFacts)?analyzed.codeFacts.length:0} symbols=${Array.isArray(analyzed?.symbols)?analyzed.symbols.length:0}`);

      const codeFacts = Array.isArray(analyzed?.codeFacts) ? analyzed.codeFacts : [];
      this.pythonAnalysis = analyzed;
      this.codeStructureFacts = codeFacts;
      this.codeStructureRows = this.materializeCodeStructureRows(codeFacts, analyzed);
      this.constructIndexVersion = Number(analyzed?.version || 0);
      if (this.constructIndexVersion !== PYTHON_ANALYZER_VERSION) return;

      const persistStarted = Date.now();
      const csvPath = await this.persistCodeStructureCsv({ language:'python', rows:this.codeStructureRows });
      const { uniqueIndexPath, valuesIndexPath } = await this.persistPalIndexes({ language:'python', rows:this.codeStructureRows });
      const metaPath = await this.persistCodeStructureMeta({
        language:'python',
        analyzerVersion:this.constructIndexVersion,
        rowCount:this.codeStructureRows.length,
        fileHashes,
        importGraph
      });
      this.constructIndexMeta = {
        status:'complete',
        repoUrl:this.repoUrl,
        requestedRevision:String(this.targetCommit || ''),
        commit:this.commit,
        language:'python',
        schemaVersion:CONSTRUCT_INDEX_SCHEMA_VERSION,
        analyzerVersion:this.constructIndexVersion,
        recordCount:this.codeStructureRows.length,
        csvRowCount:this.codeStructureRows.length,
        cachePath:metaPath,
        metaPath,
        csvPath,
        uniqueIndexPath,
        valuesIndexPath,
        reused:false
      };
      this.codeStructureFacts = [];
      console.log(`[repo-index] persisted structural CSV + PAL indexes ${Date.now()-persistStarted}ms csv=${csvPath} unique=${uniqueIndexPath} values=${valuesIndexPath} meta=${metaPath}`);
    } catch (error) {
      console.error('[repo-index] structural CSV index failed', error?.stack || error?.message || String(error));
      this.constructIndex = [];
      this.constructIndexVersion = 0;
      this.constructIndexMeta = null;
      this.pythonAnalysis = null;
      this.codeStructureFacts = [];
      this.codeStructureRows = [];
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
    if (symbol.entryPoint === true) score += 80;
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
