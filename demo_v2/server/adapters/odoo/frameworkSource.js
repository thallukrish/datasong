import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import simpleGit from 'simple-git';
import { extractOdooModels } from './modelParser.js';
import { extractOdooExecution } from './pythonExecutionParser.js';
import { parseOdooManifestText } from './detect.js';

const ODOO_REPO_URL = 'https://github.com/odoo/odoo.git';
const MODEL_FILE_CACHE = new Map();
const METHOD_FILE_CACHE = new Map();
const UI_FILE_CACHE = new Map();

function addonNameFor(sourcePath) {
  const parts = String(sourcePath || '').replace(/\\/g, '/').split('/');
  const addonsAt = parts.indexOf('addons');
  return addonsAt >= 0 ? String(parts[addonsAt + 1] || '') : '';
}

async function manifestPathForAddon(repoDir, addonName) {
  for (const relativePath of [
    `addons/${addonName}/__manifest__.py`,
    `odoo/addons/${addonName}/__manifest__.py`
  ]) {
    try {
      await fsp.access(path.join(repoDir, relativePath));
      return relativePath;
    } catch {}
  }
  return '';
}

export async function ensureOdooSource({ version, cacheRoot, sourceDir = '', gitFactory = simpleGit }) {
  const explicit = String(sourceDir || '').trim();
  const repoDir = explicit || path.join(cacheRoot, 'frameworks', 'odoo', String(version), 'source');

  if (!explicit && !fs.existsSync(path.join(repoDir, '.git'))) {
    fs.mkdirSync(path.dirname(repoDir), { recursive: true });
    await gitFactory().clone(ODOO_REPO_URL, repoDir, [
      '--config', 'core.longpaths=true',
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

export async function resolveOdooModuleClosure({ repoDir, seeds = [], maxModules = 120 }) {
  const queue = ['base', ...new Set((Array.isArray(seeds) ? seeds : []).map(String).filter(Boolean))];
  const seen = new Set();

  while (queue.length && seen.size < Math.max(1, Number(maxModules) || 120)) {
    const addonName = queue.shift();
    if (!addonName || seen.has(addonName)) continue;
    const manifestPath = await manifestPathForAddon(repoDir, addonName);
    if (!manifestPath) continue;
    seen.add(addonName);
    const text = await fsp.readFile(path.join(repoDir, manifestPath), 'utf8').catch(() => '');
    const manifest = parseOdooManifestText(text);
    for (const dependency of manifest.depends) {
      if (!seen.has(dependency)) queue.push(dependency);
    }
  }

  return [...seen].sort();
}

export async function findOdooModelFiles({ repoDir, modelName, allowedAddons = [], gitFactory = simpleGit }) {
  const wanted = String(modelName || '').trim();
  if (!wanted) return [];
  const allowedList = (Array.isArray(allowedAddons) ? allowedAddons : []).map(String).filter(Boolean).sort();
  const cacheKey = `${path.resolve(repoDir)}|${wanted}|${allowedList.join(',')}`;
  if (MODEL_FILE_CACHE.has(cacheKey)) return [...MODEL_FILE_CACHE.get(cacheKey)];

  const allowed = new Set(allowedList);
  let raw = '';
  try {
    raw = await gitFactory(repoDir).raw([
      'grep', '-l', '-F', wanted, '--', 'addons', 'odoo/addons'
    ]);
  } catch (error) {
    const text = String(error?.message || '');
    if (Number(error?.exitCode) === 1 || /exit(?:ed)?(?: with)? code 1|not found|no match/i.test(text)) {
      MODEL_FILE_CACHE.set(cacheKey, []);
      return [];
    }
    throw error;
  }

  const candidates = [...new Set(String(raw || '')
    .split(/\r?\n/)
    .map((file) => file.trim().replace(/\\/g, '/'))
    .filter((file) => file.endsWith('.py')))]
    .sort();

  const matched = [];
  for (const sourcePath of candidates) {
    const addonName = addonNameFor(sourcePath);
    if (allowed.size && !allowed.has(addonName)) continue;
    const source = await fsp.readFile(path.join(repoDir, sourcePath), 'utf8').catch(() => '');
    if (!source) continue;
    const models = extractOdooModels(sourcePath, source, addonName);
    if (models.some((model) => model.name === wanted || model.inherits.includes(wanted))) matched.push(sourcePath);
  }

  MODEL_FILE_CACHE.set(cacheKey, matched);
  return [...matched];
}

export async function findOdooMethodFiles({
  repoDir,
  modelName,
  methodName,
  allowedAddons = [],
  gitFactory = simpleGit
}) {
  const wantedModel = String(modelName || '').trim();
  const wantedMethod = String(methodName || '').trim();
  if (!wantedModel || !wantedMethod) return [];

  const allowedList = (Array.isArray(allowedAddons) ? allowedAddons : []).map(String).filter(Boolean).sort();
  const cacheKey = `${path.resolve(repoDir)}|${wantedModel}.${wantedMethod}|${allowedList.join(',')}`;
  if (METHOD_FILE_CACHE.has(cacheKey)) return [...METHOD_FILE_CACHE.get(cacheKey)];

  const allowed = new Set(allowedList);
  let raw = '';
  try {
    raw = await gitFactory(repoDir).raw([
      'grep', '-l', '-F', `def ${wantedMethod}(`, '--', 'addons', 'odoo/addons'
    ]);
  } catch (error) {
    const text = String(error?.message || '');
    if (Number(error?.exitCode) === 1 || /exit(?:ed)?(?: with)? code 1|not found|no match/i.test(text)) {
      METHOD_FILE_CACHE.set(cacheKey, []);
      return [];
    }
    throw error;
  }

  const candidates = [...new Set(String(raw || '')
    .split(/\r?\n/)
    .map((file) => file.trim().replace(/\\/g, '/'))
    .filter((file) => file.endsWith('.py')))]
    .sort();

  const matched = [];
  for (const sourcePath of candidates) {
    const addonName = addonNameFor(sourcePath);
    if (allowed.size && !allowed.has(addonName)) continue;
    const source = await fsp.readFile(path.join(repoDir, sourcePath), 'utf8').catch(() => '');
    if (!source) continue;
    const parsed = extractOdooExecution(sourcePath, source, addonName);
    if (parsed.methods.some((method) => method.modelName === wantedModel && method.methodName === wantedMethod)) {
      matched.push(sourcePath);
    }
  }

  METHOD_FILE_CACHE.set(cacheKey, matched);
  return [...matched];
}

export async function findOdooUiFiles({ repoDir, modelNames = [], allowedAddons = [], gitFactory = simpleGit }) {
  const wanted = [...new Set((Array.isArray(modelNames) ? modelNames : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean))].sort();
  if (!wanted.length) return [];

  const allowedList = (Array.isArray(allowedAddons) ? allowedAddons : []).map(String).filter(Boolean).sort();
  const cacheKey = `${path.resolve(repoDir)}|${wanted.join(',')}|${allowedList.join(',')}`;
  if (UI_FILE_CACHE.has(cacheKey)) return [...UI_FILE_CACHE.get(cacheKey)];

  const allowed = new Set(allowedList);
  const args = ['grep', '-l', '-F'];
  for (const modelName of wanted) args.push('-e', modelName);
  args.push('--', 'addons', 'odoo/addons');

  let raw = '';
  try {
    raw = await gitFactory(repoDir).raw(args);
  } catch (error) {
    const text = String(error?.message || '');
    if (Number(error?.exitCode) === 1 || /exit(?:ed)?(?: with)? code 1|not found|no match/i.test(text)) {
      UI_FILE_CACHE.set(cacheKey, []);
      return [];
    }
    throw error;
  }

  const files = [...new Set(String(raw || '')
    .split(/\r?\n/)
    .map((file) => file.trim().replace(/\\/g, '/'))
    .filter((file) => file.endsWith('.xml'))
    .filter((file) => {
      const addonName = addonNameFor(file);
      return !allowed.size || allowed.has(addonName);
    }))]
    .sort();

  UI_FILE_CACHE.set(cacheKey, files);
  return [...files];
}

export function clearOdooFrameworkSourceCaches() {
  MODEL_FILE_CACHE.clear();
  METHOD_FILE_CACHE.clear();
  UI_FILE_CACHE.clear();
}

export { ODOO_REPO_URL };