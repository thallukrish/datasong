import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { simpleGit } from 'simple-git';

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.java', '.groovy', '.xml', '.json', '.yaml', '.yml',
  '.sql', '.py', '.rb', '.go', '.cs', '.kt', '.properties', '.conf', '.md', '.txt'
]);

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const repoCacheDir = path.join(dataDir, 'repo-cache');

let workspace = null;
let searchableFiles = [];
let repositoryName = '';

export async function prepareRepo(repoUrl, previousCommit = null) {
  searchableFiles = [];
  repositoryName = repoNameFromUrl(repoUrl);
  await fs.mkdir(repoCacheDir, { recursive: true });
  workspace = path.join(repoCacheDir, repoCacheKey(repoUrl));

  let git;
  if (await isGitWorkspace(workspace)) {
    console.log(`[DataSong] repo_prepare: reusing cached checkout ${workspace}`);
    git = simpleGit(workspace);
    console.log('[DataSong] repo_prepare: fetching repository tip…');
    await git.fetch(['origin', 'HEAD', '--depth', '1']);
    console.log('[DataSong] repo_prepare: resetting cached checkout to fetched tip…');
    await git.reset(['--hard', 'FETCH_HEAD']);
  } else {
    console.log(`[DataSong] repo_prepare: cloning ${repoUrl} into persistent cache…`);
    await fs.rm(workspace, { recursive: true, force: true });
    await simpleGit().clone(repoUrl, workspace, ['--depth', '1']);
    git = simpleGit(workspace);
    console.log('[DataSong] repo_prepare: initial clone complete.');
  }

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
  const tracked = await git.raw(['ls-files']);
  searchableFiles = tracked
    .split(/\r?\n/)
    .map((relative) => relative.trim())
    .filter(Boolean)
    .filter((relative) => TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase()))
    .map((relative) => path.join(workspace, relative));
  console.log(`[DataSong] repo_prepare: ready (${searchableFiles.length} searchable files).`);

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
    cacheReused: true
  };
}

export async function listRepo(relativePath = '.') {
  ensureWorkspace();
  const normalizedPath = normalizeRepoPath(relativePath);
  const root = safeResolve(normalizedPath);
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.slice(0, 200).map((entry) => ({
      name: entry.name,
      path: path.relative(workspace, path.join(root, entry.name)).replaceAll('\\', '/'),
      type: entry.isDirectory() ? 'directory' : 'file'
    }));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const rootEntries = await fs.readdir(workspace, { withFileTypes: true });
    return {
      error: `Path '${relativePath}' does not exist in the cloned repository. Repository root is already '${repositoryName || 'the submitted repository'}'.`,
      normalizedPath,
      suggestion: 'Use paths relative to the repository root.',
      rootEntries: rootEntries.slice(0, 80).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }))
    };
  }
}

export async function searchRepo(query, maxResults = 30) {
  ensureWorkspace();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];

  for (const file of searchableFiles) {
    let text;
    try { text = await fs.readFile(file, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      const haystack = `${path.relative(workspace, file)} ${line}`.toLowerCase();
      if (tokens.every((token) => haystack.includes(token))) {
        results.push({
          path: path.relative(workspace, file).replaceAll('\\', '/'),
          line: idx + 1,
          snippet: line.trim().slice(0, 500)
        });
        if (results.length >= maxResults) return results;
      }
    }
  }
  return results;
}

export async function readRepoFile(relativePath, startLine = 1, endLine = 240) {
  ensureWorkspace();
  const normalizedPath = normalizeRepoPath(relativePath);
  const file = safeResolve(normalizedPath);

  let stat;
  try {
    stat = await fs.stat(file);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return {
      ok: false,
      error: 'path_not_found',
      path: normalizedPath,
      requestedPath: relativePath,
      suggestion: 'Search for the symbol or list the nearest known parent directory before reading a file.'
    };
  }

  if (stat.isDirectory()) {
    const entries = await fs.readdir(file, { withFileTypes: true });
    return {
      ok: false,
      error: 'path_is_directory',
      path: normalizedPath,
      requestedPath: relativePath,
      suggestion: `Do not read '${normalizedPath}' as a file. Choose one file below it or request a directory listing.`,
      entries: entries.slice(0, 120).map((entry) => ({
        name: entry.name,
        path: path.relative(workspace, path.join(file, entry.name)).replaceAll('\\', '/'),
        type: entry.isDirectory() ? 'directory' : 'file'
      }))
    };
  }

  if (!stat.isFile()) {
    return {
      ok: false,
      error: 'path_not_regular_file',
      path: normalizedPath,
      requestedPath: relativePath,
      suggestion: 'Choose a regular text file returned by repository search or listing.'
    };
  }

  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n');
  const from = Math.max(1, startLine);
  const to = Math.min(lines.length, Math.max(from, endLine));
  return {
    ok: true,
    path: normalizedPath,
    requestedPath: relativePath,
    startLine: from,
    endLine: to,
    totalLines: lines.length,
    content: lines.slice(from - 1, to).map((line, i) => `${from + i}: ${line}`).join('\n')
  };
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

function safeResolve(relativePath) {
  const root = path.resolve(workspace);
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

function repoNameFromUrl(repoUrl = '') {
  const cleaned = String(repoUrl).replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  return cleaned.split('/').filter(Boolean).pop() || '';
}
