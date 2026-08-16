import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.java', '.groovy', '.xml', '.json', '.yaml', '.yml',
  '.sql', '.py', '.rb', '.go', '.cs', '.kt', '.properties', '.conf', '.md', '.txt'
]);

let workspace = null;

export async function prepareRepo(repoUrl) {
  if (workspace) await fs.rm(workspace, { recursive: true, force: true });
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'datasong-demo-'));
  await simpleGit().clone(repoUrl, workspace, ['--depth', '1']);
  return { workspace, repoUrl };
}

export async function listRepo(relativePath = '.') {
  ensureWorkspace();
  const root = safeResolve(relativePath);
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.slice(0, 200).map((entry) => ({
    name: entry.name,
    path: path.relative(workspace, path.join(root, entry.name)).replaceAll('\\', '/'),
    type: entry.isDirectory() ? 'directory' : 'file'
  }));
}

export async function searchRepo(query, maxResults = 30) {
  ensureWorkspace();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const files = await walk(workspace);
  const results = [];

  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    let text;
    try { text = await fs.readFile(file, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    lines.forEach((line, idx) => {
      const haystack = `${path.relative(workspace, file)} ${line}`.toLowerCase();
      if (tokens.every((token) => haystack.includes(token))) {
        results.push({
          path: path.relative(workspace, file).replaceAll('\\', '/'),
          line: idx + 1,
          snippet: line.trim().slice(0, 500)
        });
      }
    });
    if (results.length >= maxResults) break;
  }

  return results.slice(0, maxResults);
}

export async function readRepoFile(relativePath, startLine = 1, endLine = 240) {
  ensureWorkspace();
  const file = safeResolve(relativePath);
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n');
  const from = Math.max(1, startLine);
  const to = Math.min(lines.length, Math.max(from, endLine));
  return {
    path: relativePath,
    startLine: from,
    endLine: to,
    totalLines: lines.length,
    content: lines.slice(from - 1, to).map((line, i) => `${from + i}: ${line}`).join('\n')
  };
}

function ensureWorkspace() {
  if (!workspace) throw new Error('Repository not prepared. Call repo_prepare first.');
}

function safeResolve(relativePath) {
  const resolved = path.resolve(workspace, relativePath);
  if (!resolved.startsWith(path.resolve(workspace))) throw new Error('Path escapes repository workspace');
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
