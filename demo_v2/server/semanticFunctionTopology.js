import fs from 'node:fs/promises';
import path from 'node:path';
import simpleGit from 'simple-git';
import { BoundaryAwareTopology } from './boundaryAwareTopology.js';

const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.env', '.properties', '.ini', '.conf']);
const CODE_WITH_GLOBALS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.java', '.kt', '.kts', '.groovy']);
const MAX_SYNTHETIC_BODY = 2200;

function normalize(value) { return String(value || '').trim(); }
function simpleName(name) {
  const pieces = normalize(name).split(/[.#:/]/).filter(Boolean);
  return pieces.at(-1) || normalize(name);
}
function semanticId(sourcePath, name, line = 1) {
  return `semantic:${sourcePath}#${encodeURIComponent(name)}@${line}`;
}
function lineNumberAt(text, offset) { return text.slice(0, offset).split(/\r?\n/).length; }
function scalarText(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  return String(value);
}
function isScalar(value) { return value === null || ['string', 'number', 'boolean'].includes(typeof value); }
function cleanConfigBase(sourcePath) {
  return path.posix.basename(sourcePath).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_$-]/g, '_') || 'config';
}
function uniqueRefs(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref.relation}:${ref.name}`;
    if (!ref.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function addRef(refs, name, relation, extra = {}) {
  const value = normalize(name);
  if (!value) return;
  refs.push({ name: value, simpleName: simpleName(value), relation, ...extra });
}

function flattenJson(value, prefix = [], out = []) {
  if (isScalar(value)) {
    out.push({ path: prefix.join('.'), value });
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length <= 12 && value.every(isScalar)) out.push({ path: prefix.join('.'), value: value.join(', ') });
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) flattenJson(child, [...prefix, key], out);
  }
  return out;
}

function parseLooseConfig(text, ext) {
  const entries = [];
  if (ext === '.env' || ext === '.properties' || ext === '.ini' || ext === '.conf') {
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const match = line.match(/^\s*([A-Za-z_][\w.-]*)\s*[=:]\s*(.*?)\s*$/);
      if (!match || match[1].startsWith('#')) continue;
      entries.push({ path: match[1], value: match[2], line: index + 1 });
    }
    return entries;
  }
  if (ext === '.yaml' || ext === '.yml') {
    const stack = [];
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const match = line.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/);
      if (!match) continue;
      const indent = match[1].length;
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const key = match[2];
      const raw = match[3];
      if (!raw) { stack.push({ indent, key }); continue; }
      entries.push({ path: [...stack.map((x) => x.key), key].join('.'), value: raw, line: index + 1 });
    }
  }
  return entries;
}

export class SemanticFunctionTopology extends BoundaryAwareTopology {
  constructor(options) {
    super(options);
    this.semanticMeta = new Map();
    this.configNodeByKey = new Map();
    this.syntheticSourceText = new Map();
  }

  async prepare(repoUrl) {
    const prep = await super.prepare(repoUrl);
    const git = simpleGit(this.repoDir);
    const tracked = (await git.raw(['ls-files'])).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

    this.semanticMeta.clear();
    this.configNodeByKey.clear();
    this.syntheticSourceText.clear();

    for (const rel of tracked) {
      const ext = path.extname(rel).toLowerCase();
      if (!CONFIG_EXTENSIONS.has(ext) && !CODE_WITH_GLOBALS.has(ext)) continue;
      const abs = path.join(this.repoDir, rel);
      const text = await fs.readFile(abs, 'utf8').catch(() => '');
      if (!text || text.length > 750_000) continue;
      this.syntheticSourceText.set(rel, text);
      if (CONFIG_EXTENSIONS.has(ext)) this.synthesizeConfigFunctions(rel, text, ext);
    }

    for (const rel of tracked) {
      const ext = path.extname(rel).toLowerCase();
      const text = this.syntheticSourceText.get(rel);
      if (!text || !CODE_WITH_GLOBALS.has(ext)) continue;
      this.synthesizeModuleFunction(rel, text);
      this.synthesizeConstants(rel, text);
    }

    this.reindexAllSymbols();
    this.augmentSemanticReferences();
    this.rebuildCallers();

    return {
      ...prep,
      searchableSymbols: this.symbols.length,
      semanticFunctions: this.symbols.length,
      root: this.repositoryOrientation()
    };
  }

  addSemanticFunction({ sourcePath, name, symbolKind, line = 1, body = '', signature = '', value = undefined, semanticType = '' }) {
    const id = semanticId(sourcePath, name, line);
    if (this.symbolById.has(id)) return this.symbolById.get(id);
    const symbol = {
      id,
      name,
      simpleName: simpleName(name),
      symbolKind,
      signature: signature || `${name}()`,
      sourcePath,
      startLine: line,
      endLine: line + Math.max(0, body.split(/\r?\n/).length - 1),
      body: body.slice(0, MAX_SYNTHETIC_BODY),
      references: []
    };
    if (value !== undefined) symbol.semanticValue = value;
    symbol.semanticType = semanticType || symbolKind;
    this.symbols.push(symbol);
    this.symbolById.set(id, symbol);
    this.semanticMeta.set(id, { synthetic: true, semanticType: symbol.semanticType });
    return symbol;
  }

  synthesizeConfigFunctions(sourcePath, text, ext) {
    const base = cleanConfigBase(sourcePath);
    let entries = [];
    if (ext === '.json') {
      try { entries = flattenJson(JSON.parse(text)).map((entry) => ({ ...entry, line: 1 })); }
      catch { entries = []; }
    } else entries = parseLooseConfig(text, ext);

    for (const entry of entries.slice(0, 600)) {
      if (!entry.path) continue;
      const name = `$config.${base}.${entry.path}`;
      const node = this.addSemanticFunction({
        sourcePath,
        name,
        symbolKind: 'config_value',
        semanticType: 'value_function',
        line: entry.line || 1,
        signature: `${name}() -> value`,
        body: `returns ${scalarText(entry.value)}`,
        value: entry.value
      });
      this.configNodeByKey.set(`${sourcePath}:${entry.path}`.toLowerCase(), node.id);
      this.configNodeByKey.set(`${base}:${entry.path}`.toLowerCase(), node.id);
    }
  }

  synthesizeModuleFunction(sourcePath, text) {
    const ranges = this.symbols
      .filter((symbol) => symbol.sourcePath === sourcePath && !this.semanticMeta.get(symbol.id)?.synthetic)
      .map((symbol) => [symbol.startLine, symbol.endLine]);
    const lines = text.split(/\r?\n/);
    const outside = [];
    for (let i = 0; i < lines.length; i += 1) {
      const lineNo = i + 1;
      if (ranges.some(([start, end]) => lineNo >= start && lineNo <= end)) continue;
      const line = lines[i];
      if (!line.trim() || /^\s*(?:\/\/|\/\*|\*|#)/.test(line)) continue;
      outside.push({ lineNo, line });
    }
    if (!outside.length) return;
    const body = outside.slice(0, 80).map((x) => x.line).join('\n');
    this.addSemanticFunction({
      sourcePath,
      name: `$module_init.${path.posix.basename(sourcePath)}`,
      symbolKind: 'module_init',
      semanticType: 'global_function',
      line: outside[0].lineNo,
      signature: `$module_init(${sourcePath})`,
      body
    });
  }

  synthesizeConstants(sourcePath, text) {
    const ext = path.extname(sourcePath).toLowerCase();
    if (!['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) return;
    const regex = /\bconst\s+([A-Z][A-Z0-9_]{2,})\s*=\s*([^;\n]+)/g;
    let match;
    while ((match = regex.exec(text))) {
      const raw = match[2].trim();
      if (raw.length > 160) continue;
      const name = `$constant.${path.posix.basename(sourcePath).replace(/\.[^.]+$/, '')}.${match[1]}`;
      this.addSemanticFunction({
        sourcePath,
        name,
        symbolKind: 'semantic_constant',
        semanticType: 'value_function',
        line: lineNumberAt(text, match.index),
        signature: `${name}() -> value`,
        body: `returns ${raw}`,
        value: raw
      });
    }
  }

  reindexAllSymbols() {
    this.nameIndex.clear();
    this.symbolById.clear();
    for (const symbol of this.symbols) {
      this.symbolById.set(symbol.id, symbol);
      for (const key of new Set([normalize(symbol.name).toLowerCase(), normalize(symbol.simpleName).toLowerCase()])) {
        if (!key) continue;
        if (!this.nameIndex.has(key)) this.nameIndex.set(key, []);
        this.nameIndex.get(key).push(symbol.id);
      }
    }
  }

  augmentSemanticReferences() {
    for (const symbol of [...this.symbols]) {
      const refs = [...(symbol.references || [])];
      const body = symbol.body || '';
      const ext = path.extname(symbol.sourcePath || '').toLowerCase();

      this.addEnvironmentReferences(symbol, body, refs);
      this.addConstantReferences(symbol, body, refs);
      this.addConfigImportReferences(symbol, body, refs);

      if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'].includes(ext)) {
        this.addCallbackTopology(symbol, body, refs);
      }
      symbol.references = uniqueRefs(refs);
    }
  }

  addEnvironmentReferences(symbol, body, refs) {
    const regex = /\b(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)\b/g;
    let match;
    while ((match = regex.exec(body))) {
      const name = `$env.${match[1]}`;
      let node = this.symbols.find((s) => s.name === name);
      if (!node) node = this.addSemanticFunction({
        sourcePath: '$environment', name, symbolKind: 'environment_value', semanticType: 'value_function',
        signature: `${name}() -> environment value`, body: 'returns deployment/runtime environment value'
      });
      addRef(refs, node.name, 'configured_by', { explicit: true });
    }
  }

  addConstantReferences(symbol, body, refs) {
    for (const constant of this.symbols.filter((s) => s.symbolKind === 'semantic_constant' && s.sourcePath === symbol.sourcePath)) {
      const constantName = constant.name.split('.').at(-1);
      if (constant.id === symbol.id || !constantName) continue;
      if (new RegExp(`\\b${constantName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`).test(body)) addRef(refs, constant.name, 'configured_by', { explicit: true });
    }
  }

  addConfigImportReferences(symbol, body, refs) {
    const sourceText = this.syntheticSourceText.get(symbol.sourcePath) || '';
    const imports = [];
    let match;
    const requireRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(["']([^"']+\.(?:json|ya?ml))["']\)/g;
    while ((match = requireRegex.exec(sourceText))) imports.push({ alias: match[1], target: match[2] });
    const importRegex = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+\.(?:json|ya?ml))["']/g;
    while ((match = importRegex.exec(sourceText))) imports.push({ alias: match[1], target: match[2] });

    for (const imp of imports) {
      const targetPath = path.posix.normalize(path.posix.join(path.posix.dirname(symbol.sourcePath), imp.target));
      const propRegex = new RegExp(`\\b${imp.alias.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\.([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)`, 'g');
      while ((match = propRegex.exec(body))) {
        const key = `${targetPath}:${match[1]}`.toLowerCase();
        const id = this.configNodeByKey.get(key);
        const node = id ? this.symbolById.get(id) : null;
        if (node) addRef(refs, node.name, 'configured_by', { explicit: true });
      }
    }
  }

  addCallbackTopology(owner, body, refs) {
    const registrations = [
      { regex: /\.addEventListener\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)/g, kind: 'ui_event', relation: 'triggers' },
      { regex: /\bon([A-Z][A-Za-z0-9_]*)\s*=\s*\{?\s*([A-Za-z_$][\w$]*)/g, kind: 'ui_event', relation: 'triggers', jsx: true },
      { regex: /\.on\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)/g, kind: 'event', relation: 'handles' }
    ];

    for (const spec of registrations) {
      let match;
      while ((match = spec.regex.exec(body))) {
        const eventName = spec.jsx ? match[1].replace(/^./, (c) => c.toLowerCase()) : match[1];
        const handler = match[2];
        const line = owner.startLine + lineNumberAt(body, match.index) - 1;
        const name = `$event.${eventName}@${path.posix.basename(owner.sourcePath)}:${line}`;
        const event = this.addSemanticFunction({
          sourcePath: owner.sourcePath, name, symbolKind: spec.kind, semanticType: 'trigger_function', line,
          signature: `${name}() -> triggers handler`, body: `event ${eventName} triggers ${handler}`
        });
        addRef(refs, event.name, 'registers', { explicit: true });
        addRef(event.references, handler, spec.relation, { explicit: true });
      }
    }

    let match;
    const success = /\.then\(\s*([A-Za-z_$][\w$]*)/g;
    while ((match = success.exec(body))) addRef(refs, match[1], 'on_success', { explicit: true });
    const failure = /\.catch\(\s*([A-Za-z_$][\w$]*)/g;
    while ((match = failure.exec(body))) addRef(refs, match[1], 'on_error', { explicit: true });
    const timers = /\bset(?:Timeout|Interval)\(\s*([A-Za-z_$][\w$]*)/g;
    while ((match = timers.exec(body))) addRef(refs, match[1], 'delayed_trigger', { explicit: true });
  }

  rebuildCallers() {
    this.callers.clear();
    for (const symbol of this.symbols) {
      symbol.references = uniqueRefs(symbol.references || []);
      for (const ref of symbol.references) {
        for (const target of this.resolveReference(ref).slice(0, 6)) {
          if (!this.callers.has(target.id)) this.callers.set(target.id, []);
          this.callers.get(target.id).push({ sourceId: symbol.id, relation: ref.relation });
        }
      }
    }
  }

  relationPriority(relation) {
    const semantic = {
      triggers: 130, handles: 128, on_success: 126, on_error: 126, delayed_trigger: 124,
      registers: 120, configured_by: 116, calls: 110, routes_to: 108, writes: 102, reads: 98, called_by: 75
    };
    return semantic[relation] || super.relationPriority(relation);
  }

  entryPriority(symbol) {
    let score = super.entryPriority(symbol);
    if (symbol.symbolKind === 'module_init') score += 45;
    if (['ui_event', 'event'].includes(symbol.symbolKind)) score += 50;
    if (symbol.symbolKind === 'config_value' || symbol.symbolKind === 'semantic_constant' || symbol.symbolKind === 'environment_value') score -= 30;
    return score;
  }

  describeCandidate(symbol, relation, hint = '') {
    const candidate = super.describeCandidate(symbol, relation, hint);
    return {
      ...candidate,
      kind: 'semantic_function',
      semanticType: symbol.semanticType || symbol.symbolKind,
      value: symbol.semanticValue,
      label: symbol.name
    };
  }

  async observe(idOrPath) {
    const observation = await super.observe(idOrPath);
    if (!observation || observation.kind === 'external_boundary' || observation.kind === 'symbol_index' || observation.kind === 'missing') return observation;
    const symbol = this.symbolById.get(observation.id);
    return {
      ...observation,
      kind: 'semantic_function',
      semanticType: symbol?.semanticType || symbol?.symbolKind || observation.symbolKind,
      semanticValue: symbol?.semanticValue,
      summary: `${symbol?.semanticType || symbol?.symbolKind || 'function'} ${symbol?.name || observation.symbolName} in ${symbol?.sourcePath || observation.sourcePath}`
    };
  }
}
