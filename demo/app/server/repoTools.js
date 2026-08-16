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

  await simpleGit().clone(repoUrl, workspace, ['--depth', '100']);
  const git = simpleGit(workspace);
  const currentCommit = (await git.revparse(['HEAD'])).trim();

  let changedFiles = [];
  let comparisonAvailable = true;
  let comparisonReason = previousCommit ? 'repository unchanged' : 'first scan';

  if (previousCommit && previousCommit !== currentCommit) {
    try {
      let hasPrevious = true;
      try {
        await git.raw(['cat-file', '-e', `${previousCommit}^{commit}`]);
      } catch {
        hasPrevious = false;
      }

      if (!hasPrevious) {
        try {
          await git.fetch(['origin', previousCommit, '--depth', '1']);
        } catch {
          // If this commit cannot be fetched directly, the caller will conservatively re-check existing knowledge.
        }
      }

      await git.raw(['cat-file', '-e', `${previousCommit}^{commit}`]);
      const diff = await git.diff(['--name-only', previousCommit, currentCommit]);
      changedFiles = diff.split(/\r?\n/).map((item) => item.trim().replaceAll('\\', '/')).filter(Boolean);
      comparisonReason = `${changedFiles.length} files changed since the last completed scan`;
    } catch (error) {
      comparisonAvailable = false;
      changedFiles = null;
      comparisonReason = `unable to compare with prior commit ${previousCommit}: ${error.message}`;
    }
  }

  searchableFiles = (await walk(workspace)).filter((file) => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()));

  return {
    workspace,
    repoUrl,
    repositoryName,
    currentCommit,
    previousCommit,
    commitChanged: Boolean(previousCommit && previousCommit !== currentCommit),
    comparisonAvailable,
    comparisonReason,
    changedFiles,
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

async function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'build' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full);
      if (out.length > 12000) return out;
    }
  }
  return out;
}

function repoNameFromUrl(repoUrl = '') {
  const cleaned = String(repoUrl).replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  return cleaned.split('/').filter(Boolean).pop() || '';
}
