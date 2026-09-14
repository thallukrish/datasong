import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import simpleGit from 'simple-git';
import { extractOdooModels } from './modelParser.js';

const ODOO_REPO_URL = 'https://github.com/odoo/odoo.git';

function addonNameFor(sourcePath) {
  const parts = String(sourcePath || '').replace(/\\/g, '/').split('/');
  const addonsAt = parts.indexOf('addons');
  return addonsAt >= 0 ? String(parts[addonsAt + 1] || '') : '';
}

export async function ensureOdooSource({ version, cacheRoot, sourceDir = '', gitFactory = simpleGit }) {
  const explicit = String(sourceDir || '').trim();
  const repoDir = explicit || path.join(cacheRoot, 'frameworks', 'odoo', String(version), 'source');

  if (!explicit && !fs.existsSync(path.join(repoDir, '.git'))) {
    fs.mkdirSync(path.dirname(repoDir), { recursive: true });
    await gitFactory().clone(ODOO_REPO_URL, repoDir, [
      '--branch', `${version}.0`,
      '--single-branch',
      '--depth', '1'
    ]);
  }

  if (!fs.existsSync(repoDir)) throw new Error(`Odoo source directory not found: ${repoDir}`);
  const git = gitFactory(repoDir);
  const commit = String(await git.revparse(['HEAD'])).trim();
  return { repoDir, commit, repoUrl: ODOO_REPO_URL };
}

export async function findOdooModelFiles({ repoDir, modelName, gitFactory = simpleGit }) {
  const wanted = String(modelName || '').trim();
  if (!wanted) return [];

  let raw = '';
  try {
    raw = await gitFactory(repoDir).raw([
      'grep', '-l', '-F', wanted, '--', 'addons', 'odoo/addons'
    ]);
  } catch (error) {
    const text = String(error?.message || '');
    if (/exit code 1|not found|no match/i.test(text)) return [];
    throw error;
  }

  const candidates = [...new Set(String(raw || '')
    .split(/\r?\n/)
    .map((file) => file.trim().replace(/\\/g, '/'))
    .filter((file) => file.endsWith('.py')))]
    .sort();

  const matched = [];
  for (const sourcePath of candidates) {
    const source = await fsp.readFile(path.join(repoDir, sourcePath), 'utf8').catch(() => '');
    if (!source) continue;
    const models = extractOdooModels(sourcePath, source, addonNameFor(sourcePath));
    if (models.some((model) => model.name === wanted || model.inherits.includes(wanted))) matched.push(sourcePath);
  }
  return matched;
}

export { ODOO_REPO_URL };
