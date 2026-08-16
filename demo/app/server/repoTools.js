import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.java', '.groovy', '.xml', '.json', '.yaml', '.yml',
  '.sql', '.py', '.rb', '.go', '.cs', '.kt', '.properties', '.conf', '.md', '.txt'
]);

let workspace = null;
let searchableFiles = [];
let repositoryName = '';

export async function prepareRepo(repoUrl, previousCommit = null) {
  if (workspace) await fs.rm(workspace, { recursive: true, force: true });
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'datasong-demo-'));
  searchableFiles = [];
  repositoryName = repoNameFromUrl(repoUrl);

  // Only fetch the current tip initially. If an older commit is needed for comparison,
  // fetch that exact commit afterwards instead of cloning a deep history up front.
  await simpleGit().clone(repoUrl, workspace, ['--depth', '1']);
  const git = simpleGit(workspace);
  const currentCommit = (await git.revparse(['HEAD'])).trim();
  const rootTree = (await git.revparse([`${currentCommit}^{tree}`])).trim();

  let previousRootTree = null;
  let changedFiles = [];
  let changedTrees = [];
  let comparisonAvailable = true;
  let comparisonReason = previousCommit ? 'repository unchanged' : 'first scan';

  if (previousCommit && previousCommit !== currentCommit) {
    try {
      await ensureCommit(git, previousCommit);
      previousRootTree = (await git.revparse([`${previousCommit}^{tree}`])).trim();
      const diff = await git.diff(['--name-only', previousCommit, currentCommit]);
      changedFiles = diff.split(/\r?\n/).map(normalizePath).filter(Boolean);

      // Only inspect tree SHAs for directories that are ancestors of changed files.
      // This gives us hierarchical change information without recursively enumerating
      // every tree in the repository.
      const affectedDirs = affectedDirectories(changedFiles);
      changedTrees = await resolveChangedTrees(git, previousCommit, currentCommit, affectedDirs);
      comparisonReason = `${changedFiles.length} files changed across ${changedTrees.length} affected directory trees since the last completed scan`;
    } catch (error) {
      comparisonAvailable = false;
      changedFiles = null;
      changedTrees = null;
      comparisonReason = `unable to compare with prior commit ${previousCommit}: ${error.message}`;
    }
  } else if (previousCommit === currentCommit) {
    previousRootTree = rootTree;
  }

  // Git already knows the tracked file list. This is much faster than recursively
  // walking the checkout on Windows, and is enough for repository text search.
  const tracked = await git.raw(['ls-files']);
  searchableFiles = tracked
    .split(/\r?\n/)
    .map((relative) => relative.trim())
    .filter(Boolean)
    .filter((relative) => TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase()))
    .map((relative) => path.join(workspace, relative));

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
    searchableFiles: searchableFiles.length
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
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n');
  const from = Math.max(1, startLine);
  const to = Math.min(lines.length, Math.max(from, endLine));
  return {
    path: normalizedPath,
    requestedPath: relativePath,
    startLine: from,
    endLine: to,
    totalLines: lines.length,
    content: lines.slice(from - 1, to).map((line, i) => `${from + i}: ${line}`).join('\n')
  };
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

function repoNameFromUrl(repoUrl = '') {
  const cleaned = String(repoUrl).replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  return cleaned.split('/').filter(Boolean).pop() || '';
}
