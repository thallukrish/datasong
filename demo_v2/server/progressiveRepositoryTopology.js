import fs from 'node:fs/promises';
import path from 'node:path';
import simpleGit from 'simple-git';
import { CanonicalSemanticTopologyV4 } from './canonicalSemanticTopologyV4.js';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.java', '.kt', '.kts', '.groovy', '.go', '.rs', '.cs', '.rb', '.php', '.scala', '.vue', '.svelte']);
const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.env', '.properties', '.ini', '.conf']);
const DIRECT_TEXT_EXTENSIONS = new Set(['.xml', '.md', '.txt', '.sql', '.gradle']);
const MAX_DIRECT_TEXT = 40000;

function cleanRepoPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
function fileId(filePath) { return `file:${cleanRepoPath(filePath)}`; }
function dirId(dirPath) { const p = cleanRepoPath(dirPath); return `dir:${p || '.'}`; }
function isTextLike(ext) { return SOURCE_EXTENSIONS.has(ext) || CONFIG_EXTENSIONS.has(ext) || DIRECT_TEXT_EXTENSIONS.has(ext); }

export class ProgressiveRepositoryTopology extends CanonicalSemanticTopologyV4 {
  constructor(options) {
    super(options);
    this.trackedFiles = [];
    this.openedFiles = new Set();
    this.openedDirectories = new Set();
  }

  async prepare(repoUrl) {
    const prep = await super.prepare(repoUrl);
    const git = simpleGit(this.repoDir);
    this.trackedFiles = (await git.raw(['ls-files'])).split(/\r?\n/).map((x) => cleanRepoPath(x)).filter(Boolean);
    this.openedFiles.clear();
    this.openedDirectories.clear();
    return {
      ...prep,
      root: this.listDirectory('')
    };
  }

  entryForPath(parent, name, isDirectory) {
    const relativePath = cleanRepoPath(parent ? `${parent}/${name}` : name);
    return {
      id: isDirectory ? dirId(relativePath) : fileId(relativePath),
      path: relativePath,
      kind: isDirectory ? 'directory' : 'file',
      relation: 'contains',
      label: name,
      hint: isDirectory ? 'directory' : `file ${path.posix.extname(name).toLowerCase() || '(no extension)'}`
    };
  }

  listDirectory(dirPath = '') {
    const normalized = cleanRepoPath(dirPath === '.' ? '' : dirPath);
    const prefix = normalized ? `${normalized}/` : '';
    const dirs = new Set();
    const files = new Set();
    for (const tracked of this.trackedFiles) {
      if (!tracked.startsWith(prefix)) continue;
      const rest = tracked.slice(prefix.length);
      if (!rest || rest.startsWith('../')) continue;
      const slash = rest.indexOf('/');
      if (slash >= 0) dirs.add(rest.slice(0, slash));
      else files.add(rest);
    }
    this.openedDirectories.add(normalized || '.');
    const entries = [
      ...[...dirs].sort().map((name) => this.entryForPath(normalized, name, true)),
      ...[...files].sort().map((name) => this.entryForPath(normalized, name, false))
    ];
    return {
      id: dirId(normalized),
      path: normalized || '.',
      kind: 'repo_directory',
      summary: `Repository directory ${normalized || '/'}`,
      canonical: {
        kind: 'directory_listing',
        path: normalized || '/',
        entries: entries.map(({ id, path: p, kind, label }) => ({ id, path: p, kind, name: label }))
      },
      excerpt: '',
      neighbors: entries
    };
  }

  symbolsForFile(sourcePath) {
    return this.symbols
      .filter((symbol) => symbol.sourcePath === sourcePath && !String(symbol.name || '').startsWith('$xml.'))
      .sort((a, b) => Number(a.startLine || 0) - Number(b.startLine || 0));
  }

  structuredUnitsForFile(sourcePath) {
    return this.symbols
      .filter((symbol) => symbol.sourcePath === sourcePath && String(symbol.name || '').startsWith('$xml.'))
      .sort((a, b) => Number(a.startLine || 0) - Number(b.startLine || 0));
  }

  functionDescriptor(symbol) {
    return {
      id: symbol.id,
      name: symbol.name,
      kind: symbol.symbolKind,
      signature: symbol.signature,
      lines: [symbol.startLine, symbol.endLine]
    };
  }

  async inspectFile(sourcePath) {
    const rel = cleanRepoPath(sourcePath);
    if (!this.trackedFiles.includes(rel)) return { id: fileId(rel), path: rel, kind: 'missing', summary: 'File not found.', neighbors: [] };
    this.openedFiles.add(rel);
    const ext = path.posix.extname(rel).toLowerCase();
    const abs = path.join(this.repoDir, rel);
    const text = isTextLike(ext) ? await fs.readFile(abs, 'utf8').catch(() => '') : '';
    const parent = cleanRepoPath(path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel));

    if (SOURCE_EXTENSIONS.has(ext)) {
      const functions = this.symbolsForFile(rel);
      const neighbors = functions.map((symbol) => ({
        id: symbol.id,
        path: `${rel}#${symbol.name}`,
        kind: 'function',
        relation: 'declares',
        label: symbol.name,
        hint: symbol.signature
      }));
      return {
        id: fileId(rel),
        path: rel,
        kind: 'source_file_index',
        summary: `${rel}: ${functions.length} parsed functions/methods`,
        canonical: { kind: 'source_file_index', path: rel, functions: functions.map((s) => this.functionDescriptor(s)) },
        excerpt: '',
        neighbors,
        parentDirectory: dirId(parent)
      };
    }

    if (ext === '.xml') {
      const units = this.structuredUnitsForFile(rel);
      const clipped = text.length > MAX_DIRECT_TEXT;
      return {
        id: fileId(rel),
        path: rel,
        kind: 'xml_file',
        summary: `${rel}: XML file${clipped ? ' (content clipped for transport)' : ''}`,
        canonical: {
          kind: 'xml_file',
          path: rel,
          content: clipped ? `${text.slice(0, MAX_DIRECT_TEXT)}\n…[clipped]` : text,
          structuredUnits: units.map((s) => this.functionDescriptor(s))
        },
        excerpt: '',
        neighbors: units.map((symbol) => ({
          id: symbol.id,
          path: `${rel}#${symbol.name}`,
          kind: 'xml_unit',
          relation: 'contains',
          label: symbol.name,
          hint: symbol.signature
        })),
        parentDirectory: dirId(parent)
      };
    }

    if (CONFIG_EXTENSIONS.has(ext)) {
      const configSymbols = this.symbols.filter((symbol) => symbol.sourcePath === rel && ['config_value', 'json_object'].includes(String(symbol.symbolKind || '')));
      return {
        id: fileId(rel), path: rel, kind: 'config_file', summary: `${rel}: configuration`,
        canonical: {
          kind: 'config_file', path: rel,
          values: configSymbols.slice(0, 200).map((s) => ({ id: s.id, name: s.name, value: s.semanticValue }))
        },
        excerpt: '',
        neighbors: configSymbols.slice(0, 200).map((symbol) => ({ id: symbol.id, path: `${rel}#${symbol.name}`, kind: 'config_item', relation: 'contains', label: symbol.name, hint: symbol.signature })),
        parentDirectory: dirId(parent)
      };
    }

    if (text) {
      const clipped = text.length > MAX_DIRECT_TEXT;
      return {
        id: fileId(rel), path: rel, kind: 'text_file', summary: `${rel}: text/document`,
        canonical: { kind: 'text_file', path: rel, content: clipped ? `${text.slice(0, MAX_DIRECT_TEXT)}\n…[clipped]` : text },
        excerpt: '', neighbors: [], parentDirectory: dirId(parent)
      };
    }

    return {
      id: fileId(rel), path: rel, kind: 'opaque_file', summary: `${rel}: non-text artifact`,
      canonical: { kind: 'opaque_file', path: rel }, excerpt: '', neighbors: [], parentDirectory: dirId(parent)
    };
  }

  calledFunctionDescriptors(symbol) {
    const seen = new Set();
    const out = [];
    for (const candidate of this.symbolNeighbors(symbol)) {
      if (!['calls', 'routes_to', 'reads', 'writes', 'configured_by', 'on_success', 'on_failure', 'handles', 'triggers', 'next_in_source'].includes(candidate.relation)) continue;
      const target = this.symbolById.get(candidate.id);
      if (!target || seen.has(target.id)) continue;
      seen.add(target.id);
      out.push({
        id: target.id,
        relation: candidate.relation,
        name: target.name,
        signature: target.signature,
        source: target.sourcePath,
        kind: target.symbolKind
      });
    }
    return out;
  }

  async getFunction(id) {
    const symbol = this.symbolById.get(String(id || ''));
    if (!symbol) return null;
    this.coveredUnits.add(symbol.id);
    const calls = this.calledFunctionDescriptors(symbol);
    return {
      id: symbol.id,
      path: `${symbol.sourcePath}#${symbol.name}`,
      kind: 'semantic_function',
      symbolKind: symbol.symbolKind,
      symbolName: symbol.name,
      sourcePath: symbol.sourcePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      summary: `${symbol.name} in ${symbol.sourcePath}`,
      canonical: {
        kind: 'semantic_function',
        id: symbol.id,
        function: symbol.name,
        signature: symbol.signature,
        body: symbol.body || '',
        calledFunctions: calls,
        provenance: { source: symbol.sourcePath, lines: [symbol.startLine, symbol.endLine] }
      },
      excerpt: '',
      neighbors: calls.map((item) => ({
        id: item.id,
        path: `${item.source}#${item.name}`,
        kind: 'function',
        relation: item.relation,
        label: item.name,
        hint: item.signature
      })),
      sourceCoverage: this.coverageFor(symbol.sourcePath)
    };
  }

  async getArtifact(idOrPath) {
    const raw = String(idOrPath || '');
    if (raw.startsWith('dir:')) return this.listDirectory(raw.slice(4) === '.' ? '' : raw.slice(4));
    if (raw.startsWith('file:')) return this.inspectFile(raw.slice(5));
    if (this.symbolById.has(raw)) return this.getFunction(raw);
    if (this.trackedFiles.includes(cleanRepoPath(raw))) return this.inspectFile(raw);
    return super.getArtifact(raw);
  }

  repositoryCoverageSnapshot() {
    return {
      directoriesOpened: [...this.openedDirectories],
      filesOpened: [...this.openedFiles],
      semanticUnits: this.coverageSnapshot()
    };
  }
}
