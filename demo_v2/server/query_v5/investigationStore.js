import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const safe = (v) => String(v || '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);

export function createInvestigationStore(dataRoot) {
  const dir = path.join(dataRoot, 'query-runs-v5', 'investigations');
  fs.mkdirSync(dir, { recursive:true });

  const fileFor = (id) => path.join(dir, `${safe(id)}.json`);
  const save = (record) => {
    const next = { ...record, updatedAt:new Date().toISOString() };
    fs.writeFileSync(fileFor(next.id), JSON.stringify(next, null, 2), 'utf8');
    return next;
  };
  const create = (seed = {}) => save({
    version:1,
    id:randomUUID(),
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    status:'plan_review',
    mode:'debugging',
    revisions:0,
    exploredFingerprints:[],
    exhaustedFingerprints:[],
    learningRequests:[],
    ...seed
  });
  const get = (id) => {
    const file = fileFor(id);
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  };
  const list = () => fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { create, save, get, list };
}
