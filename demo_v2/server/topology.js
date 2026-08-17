import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import simpleGit from 'simple-git';

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.java', '.kt', '.kts', '.py', '.rb', '.go', '.rs', '.cs',
  '.xml', '.json', '.yaml', '.yml', '.gradle', '.groovy', '.properties', '.sql', '.html', '.htm', '.md', '.txt',
  '.sh', '.ps1', '.php', '.scala', '.vue', '.svelte'
]);

const MAX_FILE_BYTES = 750_000;
const MAX_EXCERPT_CHARS = 7000;
const MAX_CHILDREN = 24;
const MAX_SEARCH_RESULTS = 12;

function normalizeRepoUrl(repoUrl) {
  return String(repoUrl || '').trim().replace(/\/$/, '');
}

function repoKey(repoUrl) {
  return crypto.createHash('sha1').update(normalizeRepoUrl(repoUrl)).digest('hex').slice(0, 16);
}

function posix(rel) {
  return rel.split(path.sep).join('/');
}

function artifactId(relPath, kind = 'file') {
  return `${kind}:${relPath || '.'}`;
}

function extensionLooksText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.basename(filePath).toLowerCase();
  return ['dockerfile', 'makefile', 'gradle.properties', 'pom.xml', 'component.xml'].includes(base);
}

async function safeStat(filePath) {
  try { return await fs.stat(filePath); } catch { return null; }
}

export class CodeTopology {
  constructor({ cacheRoot }) {
    this.cacheRoot = cacheRoot;
    this.repoDir = null;
    this.repoUrl = null;
    this.commit = null;
    this.files = [];
    this.fileSet = new Set();
    this.basenameIndex = new Map();
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
    this.files = tracked.filter(extensionLooksText);
    this.fileSet = new Set(this.files);
    this.basenameIndex.clear();
    for (const rel of this.files) {
      const base = path.basename(rel).toLowerCase();
      if (!this.basenameIndex.has(base)) this.basenameIndex.set(base, []);
      this.basenameIndex.get(base).push(rel);
    }
    return {
      repoUrl: this.repoUrl,
      commit: this.commit,
      searchableFiles: this.files.length,
      root: await this.observe('.')
    };
  }

  async observe(idOrPath) {
    const rel = this.resolveArtifactPath(idOrPath);
    const abs = path.join(this.repoDir, rel === '.' ? '' : rel);
    const stat = await safeStat(abs);
    if (!stat) return { id: artifactId(rel), path: rel, kind: 'missing', summary: 'Artifact no longer exists.' };

    if (stat.isDirectory()) {
      const entries = await fs.readdir(abs, { withFileTypes: true });
      const children = entries
        .filter((entry) => entry.name !== '.git')
        .map((entry) => {
          const childRel = posix(path.join(rel === '.' ? '' : rel, entry.name));
          return {
            id: artifactId(childRel, entry.isDirectory() ? 'dir' : 'file'),
            path: childRel,
            kind: entry.isDirectory() ? 'directory' : 'file',
            relation: 'contains',
            label: entry.name,
            hint: entry.isDirectory() ? 'directory' : path.extname(entry.name).slice(1) || 'file'
          };
        })
        .sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'directory' ? -1 : 1))
        .slice(0, MAX_CHILDREN);
      return {
        id: artifactId(rel, 'dir'),
        path: rel,
        kind: 'directory',
        summary: rel === '.' ? 'Repository root' : `Directory ${rel}`,
        excerpt: '',
        neighbors: children
      };
    }

    if (!stat.isFile()) return { id: artifactId(rel), path: rel, kind: 'other', summary: 'Non-regular artifact.' };
    if (stat.size > MAX_FILE_BYTES) {
      return { id: artifactId(rel), path: rel, kind: 'file', summary: `Large file (${stat.size} bytes); content omitted.`, excerpt: '', neighbors: [] };
    }

    const text = await fs.readFile(abs, 'utf8').catch(() => '');
    const excerpt = this.makeExcerpt(text);
    const neighbors = await this.localNeighbors(rel, text);
    return {
      id: artifactId(rel, 'file'),
      path: rel,
      kind: 'file',
      summary: `${rel} (${stat.size} bytes)`,
      excerpt,
      neighbors
    };
  }

  resolveArtifactPath(idOrPath) {
    const raw = String(idOrPath || '.');
    const colon = raw.indexOf(':');
    const rel = colon > 0 && ['file', 'dir'].includes(raw.slice(0, colon)) ? raw.slice(colon + 1) : raw;
    const normalized = posix(path.normalize(rel || '.'));
    if (normalized.startsWith('../') || path.isAbsolute(normalized)) throw new Error('Artifact path escapes repository');
    return normalized || '.';
  }

  makeExcerpt(text) {
    if (!text) return '';
    const lines = text.split(/\r?\n/);
    if (text.length <= MAX_EXCERPT_CHARS) return lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
    const head = lines.slice(0, 120).map((line, i) => `${i + 1}: ${line}`).join('\n');
    return head.slice(0, MAX_EXCERPT_CHARS);
  }

  async localNeighbors(rel, text) {
    const candidates = new Map();
    const add = (target, relation, hint = '') => {
      if (!target || target === rel || !this.fileSet.has(target)) return;
      const id = artifactId(target, 'file');
      if (!candidates.has(id)) candidates.set(id, { id, path: target, kind: 'file', relation, label: path.basename(target), hint });
    };

    const dir = path.posix.dirname(rel);
    for (const target of this.files) {
      if (path.posix.dirname(target) === dir && target !== rel) add(target, 'sibling', 'same directory');
      if (candidates.size >= 6) break;
    }

    const importPatterns = [
      /(?:import|require\s*\()\s*["']([^"']+)["']/g,
      /from\s+["']([^"']+)["']/g,
      /<service-call[^>]+name=["']([^"']+)["']/g,
      /<transition[^>]+name=["']([^"']+)["']/g
    ];
    const refs = [];
    for (const pattern of importPatterns) {
      let match;
      while ((match = pattern.exec(text)) && refs.length < 30) refs.push(match[1]);
    }

    for (const ref of refs) {
      const local = this.resolveLocalReference(rel, ref);
      for (const target of local) add(target, 'reference', ref);
      if (!local.length && /[.#/]/.test(ref)) {
        const hits = await this.search(ref, 3);
        for (const hit of hits) add(hit.path, 'symbol_reference', ref);
      }
    }

    return [...candidates.values()].slice(0, MAX_CHILDREN);
  }

  resolveLocalReference(fromRel, ref) {
    const out = [];
    if (ref.startsWith('.')) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), ref));
      const variants = [base, `${base}.js`, `${base}.jsx`, `${base}.ts`, `${base}.tsx`, `${base}.py`, `${base}.xml`, `${base}/index.js`, `${base}/index.ts`];
      for (const variant of variants) if (this.fileSet.has(variant)) out.push(variant);
    }
    const base = path.posix.basename(ref).toLowerCase();
    for (const [name, paths] of this.basenameIndex.entries()) {
      if (name === base || name.startsWith(`${base}.`) || name.includes(base)) out.push(...paths.slice(0, 3));
      if (out.length >= 5) break;
    }
    return [...new Set(out)].slice(0, 5);
  }

  async search(query, limit = MAX_SEARCH_RESULTS) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
    const scored = [];
    for (const rel of this.files) {
      let score = 0;
      const relLower = rel.toLowerCase();
      for (const term of terms) if (relLower.includes(term)) score += 4;
      let text = '';
      if (score < 8) {
        const abs = path.join(this.repoDir, rel);
        const stat = await safeStat(abs);
        if (!stat || stat.size > MAX_FILE_BYTES) continue;
        text = await fs.readFile(abs, 'utf8').catch(() => '');
        const low = text.toLowerCase();
        for (const term of terms) if (low.includes(term)) score += 1;
      }
      if (score > 0) scored.push({ path: rel, score, text });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ path: rel, score, text }) => ({
      id: artifactId(rel, 'file'),
      path: rel,
      kind: 'file',
      relation: 'search',
      label: path.basename(rel),
      hint: text ? this.snippet(text, terms) : `path match score ${score}`
    }));
  }

  snippet(text, terms) {
    const low = text.toLowerCase();
    let at = -1;
    for (const term of terms) { at = low.indexOf(term); if (at >= 0) break; }
    if (at < 0) return '';
    const start = Math.max(0, at - 120);
    return text.slice(start, at + 260).replace(/\s+/g, ' ').slice(0, 420);
  }
}
