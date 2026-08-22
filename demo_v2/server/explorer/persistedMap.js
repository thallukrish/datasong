import fs from 'node:fs';
import path from 'node:path';
import { MAP_VERSION, semanticObjectsFromGraph, workflowArcsFromGraph } from './mapPersistence.js';

const arr = (value) => Array.isArray(value) ? value : [];
const clone = (value) => JSON.parse(JSON.stringify(value));

export const withPersistedMap = (Base) => class PersistedMapExplorer extends Base {
  constructor(args) { super(args); this.loadMostRecentPersistedMap(); }

  async run(repoUrl) { this._mapRestoreAttempted = false; this._mapRestored = false; this._stoppedByUser = false; return super.run(repoUrl); }

  persistedMaps() {
    const dir = this.mapDirectory(); if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const saved = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        const supported = (Number(saved?.version || 0) === MAP_VERSION && Array.isArray(saved?.graph)) || (Number(saved?.version || 0) === 2 && saved?.semanticState);
        if (!supported || !saved?.repoUrl || !saved?.commit) continue;
        out.push(saved);
      } catch {}
    }
    return out.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  installPersistedMap(saved) {
    if (!saved) return null;
    let restored;
    if (Number(saved.version || 0) === 2 && saved.semanticState) {
      restored = clone(saved.semanticState);
    } else if (Number(saved.version || 0) === MAP_VERSION && Array.isArray(saved.graph)) {
      restored = this.emptyState();
      restored.semanticObjects = semanticObjectsFromGraph(saved.graph);
      const completed = workflowArcsFromGraph(saved.graph);
      const completedIds = new Set(completed.map((arc) => arc.id));
      restored.pass1Arcs = [...completed, ...clone(arr(saved.learningProgress?.incompleteArcs)).filter((arc) => !completedIds.has(arc?.id))];
      restored.pass1Scheduler = { ...(restored.pass1Scheduler || {}), ...(saved.learningProgress?.scheduler || {}) };
      restored.scout = { ...(restored.scout || {}), ...(saved.learningProgress?.scout || {}) };
    } else return null;
    restored.repoUrl = saved.repoUrl; restored.commit = saved.commit; restored.status = 'complete'; restored.stopRequested = false;
    restored.currentArtifact = null; restored.frontier = []; restored.executionStack = [];
    restored.mapPersistence = { restored: true, savedAt: saved.savedAt || '', repoUrl: saved.repoUrl, commit: saved.commit, version: Number(saved.version || MAP_VERSION) };
    restored.lastMessage = 'Loaded the existing learned semantic graph. Start learning to continue incomplete workflows.';
    this.state = restored; this._mapRestoreAttempted = true; this._mapRestored = true; this._stoppedByUser = false;
    return this.snapshot();
  }

  loadMostRecentPersistedMap() { const saved = this.persistedMaps()[0]; return saved ? this.installPersistedMap(saved) : null; }
  loadLatestPersistedMapForRepo(repoUrl) { const wanted = String(repoUrl || '').trim(); if (!wanted) return null; const saved = this.persistedMaps().find((item) => String(item.repoUrl || '').trim() === wanted); return saved ? this.installPersistedMap(saved) : null; }
};
