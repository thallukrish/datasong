import fs from 'node:fs';
import path from 'node:path';

const clone = (value) => JSON.parse(JSON.stringify(value));

export const withPersistedMap = (Base) => class PersistedMapExplorer extends Base {
  constructor(args) {
    super(args);
    this.loadMostRecentPersistedMap();
  }

  async run(repoUrl) {
    this._mapRestoreAttempted = false;
    this._mapRestored = false;
    this._stoppedByUser = false;
    return super.run(repoUrl);
  }

  persistedMaps() {
    const dir = this.mapDirectory();
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const file = path.join(dir, name);
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Number(saved?.version || 0) !== 2 || !saved?.semanticState || !saved?.repoUrl || !saved?.commit) continue;
        out.push(saved);
      } catch {}
    }
    return out.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  installPersistedMap(saved) {
    if (!saved?.semanticState) return null;
    const restored = clone(saved.semanticState);
    restored.repoUrl = saved.repoUrl;
    restored.commit = saved.commit;
    restored.status = 'complete';
    restored.stopRequested = false;
    restored.currentArtifact = null;
    restored.frontier = [];
    restored.executionStack = [];
    restored.mapPersistence = {
      restored: true,
      savedAt: saved.savedAt || '',
      repoUrl: saved.repoUrl,
      commit: saved.commit,
      version: Number(saved.version || 2)
    };
    restored.lastMessage = 'Loaded the existing enterprise map. Start learning to continue from where it stopped.';
    this.state = restored;
    this._mapRestoreAttempted = true;
    this._mapRestored = true;
    this._stoppedByUser = false;
    return this.snapshot();
  }

  loadMostRecentPersistedMap() {
    const saved = this.persistedMaps()[0];
    return saved ? this.installPersistedMap(saved) : null;
  }

  loadLatestPersistedMapForRepo(repoUrl) {
    const wanted = String(repoUrl || '').trim();
    if (!wanted) return null;
    const saved = this.persistedMaps().find((item) => String(item.repoUrl || '').trim() === wanted);
    return saved ? this.installPersistedMap(saved) : null;
  }
};
