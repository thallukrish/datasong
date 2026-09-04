import fs from 'node:fs/promises';
import path from 'node:path';
import { createEntityGraph } from './entityGraph.js';
import { createInstanceGraph } from './instanceGraph.js';

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return null; }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

export async function loadEntityGraph(file) {
  const payload = await readJson(file);
  return createEntityGraph(payload?.entities || []);
}

export async function saveEntityGraph(file, entities = []) {
  await writeJson(file, { version: 1, entities });
}

export async function loadInstanceGraph(file) {
  const payload = await readJson(file);
  return createInstanceGraph(payload?.instances || []);
}

export async function saveInstanceGraph(file, instances = []) {
  await writeJson(file, { version: 1, instances });
}
