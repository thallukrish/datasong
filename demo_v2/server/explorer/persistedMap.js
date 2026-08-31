import fs from 'node:fs';
import path from 'node:path';
import { MAP_VERSION, semanticObjectsFromGraph, workflowArcsFromGraph } from './mapPersistence.js';

const arr = (value) => Array.isArray(value) ? value : [];
const clone = (value) => JSON.parse(JSON.stringify(value));
const repoKey = (value) => String(value || '').trim().replace(/\/$/, '').toLowerCase();

export const withPersistedMap = (Base) => class PersistedMapExplorer extends Base {
  constructor(args) {
    super(args);
    const restored = this.loadMostRecentPersistedMap();
    this.startupHydration = restored
      ? Promise.resolve().then(() => this.hydratePersistedRuntime()).catch((error) => {
          this.state.runtimeHydration = { status: 'error', error: error.message || String(error) };
          console.warn(`[lemap startup] persisted-map runtime hydration failed: ${error.message || error}`);
          return { hydrated: false, reason: 'error', error: error.message || String(error) };
        })
      : Promise.resolve({ hydrated: false, reason: 'no_persisted_map' });
  }

  emptyState() {
    const fresh = super.emptyState();
    if (!this._preserveVisibleMapOnReset || !this.state) return fresh;
    this._preserveVisibleMapOnReset = false;
    const preserved = clone(this.state);
    return {
      ...preserved,
      status: 'preparing',
      stopRequested: false,
      currentArtifact: null,
      frontier: [],
      executionStack: [],
      tokenUsage: clone(fresh.tokenUsage || preserved.tokenUsage || {}),
      lastMessage: 'Preparing repository runtime; keeping the existing learned map visible.'
    };
  }

  async run(repoUrl) {
    const sameRepo = repoKey(repoUrl) && repoKey(repoUrl) === repoKey(this.state?.repoUrl);
    const hasLearnedMap = arr(this.state?.pass1Arcs).length > 0 || Object.keys(this.state?.semanticObjects || {}).length > 0;
    this._preserveVisibleMapOnReset = !!(sameRepo && hasLearnedMap);
    this._mapRestoreAttempted = false;
    this._mapRestored = false;
    this._stoppedByUser = false;
    return super.run(repoUrl);
  }

  async hydratePersistedRuntime() {
    const repoUrl = String(this.state?.repoUrl || '').trim();
    const expectedCommit = String(this.state?.commit || '').trim();
    if (!repoUrl || !expectedCommit) return { hydrated: false, reason: 'missing_map_identity' };

    this.state.runtimeHydration = { status: 'preparing', repoUrl, commit: expectedCommit };
    let result = null;
    if (typeof this.refreshSchemaCatalogForCurrentMap === 'function') {
      result = await this.refreshSchemaCatalogForCurrentMap();
      if (result?.reason === 'commit_mismatch') {
        this.state.runtimeHydration = { status: 'stale', repoUrl, commit: expectedCommit, preparedCommit: result.preparedCommit || '' };
        return { hydrated: false, reason: 'commit_mismatch', ...result };
      }
    } else if (typeof this.topology?.prepare === 'function') {
      const prepared = await this.topology.prepare(repoUrl);
      const preparedCommit = String(prepared?.commit || this.topology?.commit || '').trim();
      if (preparedCommit && preparedCommit !== expectedCommit) {
        this.state.runtimeHydration = { status: 'stale', repoUrl, commit: expectedCommit, preparedCommit };
        return { hydrated: false, reason: 'commit_mismatch', expectedCommit, preparedCommit };
      }
      result = { refreshed: true, preparedCommit };
    }

    this.state.runtimeHydration = { status: 'ready', repoUrl, commit: expectedCommit };
    this.state.lastMessage = 'Loaded the existing learned semantic graph and prepared its repository runtime.';
    this.emit?.();
    return { hydrated: true, ...(result || {}) };
  }

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
