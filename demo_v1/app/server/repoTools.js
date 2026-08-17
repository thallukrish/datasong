import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { simpleGit } from 'simple-git';

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.java', '.groovy', '.xml', '.json', '.yaml', '.yml',
  '.sql', '.py', '.rb', '.go', '.cs', '.kt', '.properties', '.conf', '.md', '.txt'
]);
const MAX_SEARCH_RESULTS_FOR_MODEL = 8;
const MAX_SEARCH_SNIPPET_CHARS = 220;
const MAX_DEPENDENCY_PROBES_PER_SEARCH = 3;

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const repoCacheDir = path.join(dataDir, 'repo-cache');

let workspace = null;
let searchableFiles = [];
let repositoryName = '';
let primaryRepoUrl = '';
let sourceRoots = new Map();
let dependencyCandidates = [];

export async function prepareRepo(repoUrl, previousCommit = null) {
  searchableFiles = [];
  sourceRoots = new Map();
  dependencyCandidates = [];
  primaryRepoUrl = repoUrl;
  repositoryName = repoNameFromUrl(repoUrl);
  await fs.mkdir(repoCacheDir, { recursive: true });
  workspace = path.join(repoCacheDir, repoCacheKey(repoUrl));

  const git = await prepareCachedCheckout(repoUrl, workspace, 'repo_prepare');
  sourceRoots.set(repositoryName, workspace);

  console.log('[DataSong] repo_prepare: reading commit and root tree…');
  const currentCommit = (await git.revparse(['HEAD'])).trim();
  const rootTree = (await git.revparse([`${currentCommit}^{tree}`])).trim();

  let previousRootTree = null;
  let changedFiles = [];
  let changedTrees = [];
  let comparisonAvailable = true;
  let comparisonReason = previousCommit ? 'repository unchanged' : 'first scan';

  if (previousCommit && previousCommit !== currentCommit) {
    try {
      console.log(`[DataSong] repo_prepare: comparing previous commit ${previousCommit.slice(0, 8)} with ${currentCommit.slice(0, 8)}…`);
      await ensureCommit(git, previousCommit);
      previousRootTree = (await git.revparse([`${previousCommit}^{tree}`])).trim();
      const diff = await git.diff(['--name-only', previousCommit, currentCommit]);
      changedFiles = diff.split(/\r?\n/).map(normalizePath).filter(Boolean);

      const affectedDirs = affectedDirectories(changedFiles);
      changedTrees = await resolveChangedTrees(git, previousCommit, currentCommit, affectedDirs);
      comparisonReason = `${changedFiles.length} files changed across ${changedTrees.length} affected directory trees since the last completed scan`;
      console.log(`[DataSong] repo_prepare: diff complete (${changedFiles.length} changed files).`);
    } catch (error) {
      comparisonAvailable = false;
      changedFiles = null;
      changedTrees = null;
      comparisonReason = `unable to compare with prior commit ${previousCommit}: ${error.message}`;
      console.warn(`[DataSong] repo_prepare: prior-commit comparison unavailable: ${error.message}`);
    }
  } else if (previousCommit === currentCommit) {
    previousRootTree = rootTree;
    console.log('[DataSong] repo_prepare: repository commit is unchanged.');
  }

  console.log('[DataSong] repo_prepare: indexing tracked text files…');
  await indexTrackedFiles(git, workspace, repositoryName, true);

  dependencyCandidates = await discoverDependencyCandidates(workspace, repoUrl);
  if (dependencyCandidates.length) {
    console.log(`[DataSong] repo_prepare: discovered source dependencies: ${dependencyCandidates.map((item) => item.name).join(', ')}`);
  }
  console.log(`[DataSong] repo_prepare: ready (${searchableFiles.length} searchable files in primary repo).`);

  return {
    workspace,
    repoUrl,
    repositoryName,
    currentCommit,
    previousCommit,
    rootTree,
    previousRootTree,
    commitChanged: Boolean(previousCommit && previousCommit !== currentCommit),
    comparisonAvailable,
    comparisonReason,
    changedFiles,
    changedTrees,
    topLevelChangedAreas: summarizeTopLevelChanges(changedFiles, changedTrees),
    searchableFiles: searchableFiles.length,
    dependencyCandidates: dependencyCandidates.map(({ name, url, status }) => ({ name, url, status })),
    cacheReused: true
  };
}

export async function listRepo(relativePath = '.') {
  ensureWorkspace();
  const resolved = resolveSourcePath(relativePath);
  try {
    const entries = await fs.readdir(resolved.absolute, { withFileTypes: true });
    return entries.slice(0, 120).map((entry) => ({
      name: entry.name,
      path: displayPath(resolved.sourceName, path.relative(resolved.root, path.join(resolved.absolute, entry.name))),
      type: entry.isDirectory() ? 'directory' : 'file'
    }));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const rootEntries = await fs.readdir(resolved.root, { withFileTypes: true });
    return {
      error: `Path '${relativePath}' does not exist in source '${resolved.sourceName}'.`,
      normalizedPath: resolved.relative,
      suggestion: 'Use a path returned by repository search/list. Dependency paths are prefixed with @component-name/.',
      rootEntries: rootEntries.slice(0, 60).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }))
    };
  }
}

export async function searchRepo(query, maxResults = MAX_SEARCH_RESULTS_FOR_MODEL) {
  ensureWorkspace();
  const limit = Math.max(1, Math.min(MAX_SEARCH_RESULTS_FOR_MODEL, Number(maxResults) || MAX_SEARCH_RESULTS_FOR_MODEL));
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];

  let results = await searchIndexedFiles(tokens, limit);
  if (results.length) return results;

  // A qualified call can legitimately point outside the submitted repository. Probe only
  // explicitly referenced sibling components, lazily, instead of broadening model searches.
  let probes = 0;
  for (const candidate of dependencyCandidates) {
    if (candidate.status === 'unavailable') continue;
    if (candidate.status !== 'attached') {
      if (probes >= MAX_DEPENDENCY_PROBES_PER_SEARCH) break;
      probes += 1;
      await attachDependency(candidate);
    }
    if (candidate.status !== 'attached') continue;
    results = await searchIndexedFiles(tokens, limit, candidate.name);
    if (results.length) return results;
  }

  return [];
}

export async function readRepoFile(relativePath, startLine = 1, endLine = 240) {
  ensureWorkspace();
  const resolved = resolveSourcePath(relativePath);
  const file = resolved.absolute;

  let stat;
  try {
    stat = await fs.stat(file);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return {
      ok: false,
      error: 'path_not_found',
      path: relativePath,
      requestedPath: relativePath,
      suggestion: 'Search for the symbol first. Use dependency-qualified paths such as @mantle-usl/service/... exactly as returned by search.'
    };
  }

  if (stat.isDirectory()) {
    const entries = await fs.readdir(file, { withFileTypes: true });
    return {
      ok: false,
      error: 'path_is_directory',
      path: relativePath,
      requestedPath: relativePath,
      suggestion: `Do not read '${relativePath}' as a file. Choose one file below it or request a directory listing.`,
      entries: entries.slice(0, 80).map((entry) => ({
        name: entry.name,
        path: displayPath(resolved.sourceName, path.relative(resolved.root, path.join(file, entry.name))),
        type: entry.isDirectory() ? 'directory' : 'file'
      }))
    };
  }

  if (!stat.isFile()) {
    return {
      ok: false,
      error: 'path_not_regular_file',
      path: relativePath,
      requestedPath: relativePath,
      suggestion: 'Choose a regular text file returned by repository search or listing.'
    };
  }

  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n');
  const from = Math.max(1, startLine);
  const requestedTo = Math.max(from, endLine);
  const to = Math.min(lines.length, Math.min(requestedTo, from + 180));
  return {
    ok: true,
    path: displayPath(resolved.sourceName, resolved.relative),
    requestedPath: relativePath,
    source: resolved.sourceName,
    startLine: from,
    endLine: to,
    totalLines: lines.length,
    content: lines.slice(from - 1, to).map((line, i) => `${from + i}: ${line}`).join('\n')
  };
}

async function prepareCachedCheckout(repoUrl, target, logPrefix) {
  let git;
  if (await isGitWorkspace(target)) {
    console.log(`[DataSong] ${logPrefix}: reusing cached checkout ${target}`);
    git = simpleGit(target);
    console.log(`[DataSong] ${logPrefix}: fetching repository tip…`);
    await git.fetch(['origin', 'HEAD', '--depth', '1']);
    await git.reset(['--hard', 'FETCH_HEAD']);
    return git;
  }

  console.log(`[DataSong] ${logPrefix}: cloning ${repoUrl} into persistent cache…`);
  await fs.rm(target, { recursive: true, force: true });
  await simpleGit().clone(repoUrl, target, ['--depth', '1']);
  console.log(`[DataSong] ${logPrefix}: clone complete.`);
  return simpleGit(target);
}

async function indexTrackedFiles(git, root, sourceName, primary = false) {
  const tracked = await git.raw(['ls-files']);
  const indexed = tracked
    .split(/\r?\n/)
    .map((relative) => relative.trim())
    .filter(Boolean)
    .filter((relative) => TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase()))
    .map((relative) => ({ sourceName, root, relative, absolute: path.join(root, relative), primary }));
  searchableFiles.push(...indexed);
  return indexed.length;
}

async function searchIndexedFiles(tokens, limit, sourceName = null) {
  const results = [];
  const seen = new Set();
  for (const item of searchableFiles) {
    if (sourceName && item.sourceName !== sourceName) continue;
    let text;
    try { text = await fs.readFile(item.absolute, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      const haystack = `${item.relative} ${line}`.toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) continue;
      const key = `${item.sourceName}:${item.relative}:${idx + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        path: displayPath(item.sourceName, item.relative),
        line: idx + 1,
        snippet: line.trim().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_SNIPPET_CHARS)
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

async function discoverDependencyCandidates(root, repoUrl) {
  const ordered = [];
  const add = (name, reason) => {
    if (!name || normalizeName(name) === normalizeName(repositoryName)) return;
    if (ordered.some((item) => normalizeName(item.name) === normalizeName(name))) return;
    const url = siblingRepoUrl(repoUrl, name);
    if (!url) return;
    ordered.push({ name, url, reason, status: 'pending' });
  };

  // Runtime component references are stronger evidence for code traversal than packaging deps,
  // so collect them first. PopCommerce, for example, explicitly references mantle-usl here.
  const buildText = await readTextIfExists(path.join(root, 'build.gradle'));
  for (const match of buildText.matchAll(/runtime:component:([A-Za-z0-9_.-]+)/g)) add(match[1], 'build runtime component reference');

  const componentText = await readTextIfExists(path.join(root, 'component.xml'));
  for (const match of componentText.matchAll(/<depends-on\s+name=["']([^"']+)["']/g)) add(match[1], 'component dependency');

  return ordered.slice(0, 8);
}

async function attachDependency(candidate) {
  const target = path.join(repoCacheDir, repoCacheKey(candidate.url));
  try {
    console.log(`[DataSong] repo_search: following explicit dependency ${candidate.name}…`);
    const git = await prepareCachedCheckout(candidate.url, target, `dependency ${candidate.name}`);
    sourceRoots.set(candidate.name, target);
    const count = await indexTrackedFiles(git, target, candidate.name, false);
    candidate.status = 'attached';
    console.log(`[DataSong] repo_search: dependency ${candidate.name} ready (${count} searchable files).`);
  } catch (error) {
    candidate.status = 'unavailable';
    candidate.error = error.message;
    console.warn(`[DataSong] repo_search: unable to attach ${candidate.name}: ${error.message}`);
  }
}

function resolveSourcePath(value = '.') {
  const raw = String(value || '.').replaceAll('\\', '/').replace(/^\.\//, '');
  if (raw.startsWith('@')) {
    const slash = raw.indexOf('/');
    const sourceName = slash > 1 ? raw.slice(1, slash) : raw.slice(1);
    const relative = slash > 1 ? raw.slice(slash + 1) || '.' : '.';
    const root = sourceRoots.get(sourceName);
    if (!root) throw new Error(`Source dependency '${sourceName}' is not attached. Search for the symbol first so DataSong can attach its declared dependency.`);
    return { sourceName, root, relative, absolute: safeResolveIn(root, relative) };
  }

  let relative = normalizeRepoPath(raw);
  return { sourceName: repositoryName, root: workspace, relative, absolute: safeResolveIn(workspace, relative) };
}

function displayPath(sourceName, relativePath) {
  const clean = String(relativePath || '.').replaceAll('\\', '/');
  return sourceName === repositoryName ? clean : `@${sourceName}/${clean}`;
}

async function readTextIfExists(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return ''; }
}

async function isGitWorkspace(dir) {
  try {
    const stat = await fs.stat(path.join(dir, '.git'));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function repoCacheKey(repoUrl) {
  const hash = createHash('sha1').update(normalizeRepoUrl(repoUrl)).digest('hex').slice(0, 12);
  const name = repoNameFromUrl(repoUrl).replace(/[^A-Za-z0-9._-]+/g, '-') || 'repo';
  return `${name}-${hash}`;
}

async function ensureCommit(git, commit) {
  try {
    await git.raw(['cat-file', '-e', `${commit}^{commit}`]);
    return;
  } catch {}
  try { await git.fetch(['origin', commit, '--depth', '1']); } catch {}
  await git.raw(['cat-file', '-e', `${commit}^{commit}`]);
}

function affectedDirectories(changedFiles) {
  const dirs = new Set();
  for (const file of changedFiles) {
    const parts = normalizePath(file).split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      dirs.add(current);
    }
  }
  return [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

async function resolveChangedTrees(git, previousCommit, currentCommit, dirs) {
  const out = [];
  for (const dir of dirs) {
    const previousSha = await treeShaAt(git, previousCommit, dir);
    const currentSha = await treeShaAt(git, currentCommit, dir);
    if (previousSha !== currentSha) out.push({ path: dir, previousSha, currentSha });
  }
  return out;
}

async function treeShaAt(git, commit, dir) {
  try {
    return (await git.revparse([`${commit}:${dir}`])).trim();
  } catch {
    return null;
  }
}

function summarizeTopLevelChanges(changedFiles, changedTrees) {
  if (!Array.isArray(changedFiles) || !Array.isArray(changedTrees)) return null;
  const areas = new Map();
  for (const file of changedFiles) {
    const top = file.split('/')[0] || '.';
    if (!areas.has(top)) areas.set(top, { path: top, filesChanged: 0, treesChanged: 0 });
    areas.get(top).filesChanged += 1;
  }
  for (const tree of changedTrees) {
    const top = tree.path.split('/')[0] || '.';
    if (!areas.has(top)) areas.set(top, { path: top, filesChanged: 0, treesChanged: 0 });
    areas.get(top).treesChanged += 1;
  }
  return [...areas.values()].sort((a, b) => b.filesChanged - a.filesChanged || a.path.localeCompare(b.path));
}

function ensureWorkspace() {
  if (!workspace) throw new Error('Repository not prepared. Call repo_prepare first.');
}

function normalizeRepoPath(relativePath = '.') {
  let value = String(relativePath || '.').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!value || value === '.') return '.';
  const firstSlash = value.indexOf('/');
  const firstSegment = firstSlash >= 0 ? value.slice(0, firstSlash) : value;
  if (repositoryName && firstSegment.toLowerCase() === repositoryName.toLowerCase()) {
    value = firstSlash >= 0 ? value.slice(firstSlash + 1) : '.';
  }
  return value || '.';
}

function safeResolveIn(rootValue, relativePath) {
  const root = path.resolve(rootValue);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Path escapes repository workspace');
  return resolved;
}

function normalizePath(value = '') {
  return String(value).trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function normalizeRepoUrl(value = '') {
  return String(value).trim().replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
}

function normalizeName(value = '') { return String(value).trim().toLowerCase(); }

function siblingRepoUrl(repoUrl, siblingName) {
  try {
    const parsed = new URL(repoUrl);
    if (parsed.hostname !== 'github.com') return null;
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
    if (parts.length < 2) return null;
    return `https://github.com/${parts[0]}/${siblingName}`;
  } catch {
    return null;
  }
}

function repoNameFromUrl(repoUrl = '') {
  const cleaned = String(repoUrl).replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  return cleaned.split('/').filter(Boolean).pop() || '';
}
