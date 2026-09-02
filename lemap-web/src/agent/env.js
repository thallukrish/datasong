import fs from 'node:fs/promises';
import path from 'node:path';

function unquote(value = '') {
  const trimmed = String(value).trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseDotEnv(text = '') {
  const parsed = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = normalized.indexOf('=');
    if (eq <= 0) continue;
    const key = normalized.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    parsed[key] = unquote(normalized.slice(eq + 1));
  }
  return parsed;
}

export async function loadDotEnv({ cwd = process.cwd(), env = process.env, filenames = ['.env'] } = {}) {
  const loadedFiles = [];
  for (const filename of filenames) {
    const file = path.resolve(cwd, filename);
    let text;
    try { text = await fs.readFile(file, 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const parsed = parseDotEnv(text);
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined || env[key] === '') env[key] = value;
    }
    loadedFiles.push(file);
  }
  return loadedFiles;
}
