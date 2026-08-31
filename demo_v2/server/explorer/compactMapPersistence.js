import fs from 'node:fs';
import { MAP_VERSION, graphFromSemanticObjects } from './mapPersistence.js';
import { compactPersistedMap, compactLearningProgress } from './compactMapFormat.js';

function writeAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const backup = `${file}.bak`;
  const json = JSON.stringify(value);
  fs.writeFileSync(tmp, json, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, backup); } catch {}
    fs.rmSync(file, { force: true });
  }
  fs.renameSync(tmp, file);
}

export const withCompactMapPersistence = (Base) => class CompactMapPersistenceExplorer extends Base {
  persistSemanticMap() {
    if (this._deferPersistenceDuringApply) return;
    if (!this.state?.repoUrl || !this.state?.commit) return;
    try {
      this.closeCompletedArcs?.();
      this.enrichTraceability?.();
      fs.mkdirSync(this.mapDirectory(), { recursive: true });
      const savedAt = new Date().toISOString();
      const raw = {
        version: MAP_VERSION,
        repoUrl: this.state.repoUrl,
        commit: this.state.commit,
        savedAt,
        graph: graphFromSemanticObjects(this.state.semanticObjects),
        learningProgress: compactLearningProgress(this.state)
      };
      const learnedMap = compactPersistedMap(raw);
      writeAtomic(this.mapFilePath(), learnedMap);
      this.state.mapPersistence = {
        restored: !!this._mapRestored,
        savedAt,
        repoUrl: this.state.repoUrl,
        commit: this.state.commit,
        version: MAP_VERSION,
        format: 'compact-v1'
      };
    } catch (error) {
      console.warn(`[lemap] could not persist compact semantic map: ${error.message}`);
    }
  }
};
