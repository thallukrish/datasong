import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProgressiveRepositoryExplorerV45 } from './progressiveRepositoryExplorerV45.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeName(value) { return crypto.createHash('sha1').update(String(value || '')).digest('hex'); }
const MAP_VERSION = 2;

export class ProgressiveRepositoryExplorerV46 extends ProgressiveRepositoryExplorerV45 {
  constructor(args) {
    super(args);
    this._mapRestoreAttempted = false;
    this._mapRestored = false;
    this._stoppedByUser = false;
  }

  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'persistent-callgraph-whole-flow-v26';
    state.mapPersistence = { restored: false, savedAt: '', repoUrl: '', commit: '', version: MAP_VERSION };
    state.stopRequested = false;
    return state;
  }

  mapDirectory() {
    return path.join(this.dataRoot, 'semantic-maps');
  }

  mapFilePath(repoUrl = this.state?.repoUrl, commit = this.state?.commit) {
    if (!repoUrl || !commit) return '';
    return path.join(this.mapDirectory(), `${safeName(`${repoUrl}@${commit}`)}.json`);
  }

  restorePersistedMapIfAvailable() {
    if (this._mapRestoreAttempted) return this._mapRestored;
    if (!this.state?.repoUrl || !this.state?.commit) return false;
    this._mapRestoreAttempted = true;

    const file = this.mapFilePath();
    if (!file || !fs.existsSync(file)) return false;
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Persistence format is intentionally versioned. Structural changes to map
      // semantics must not silently restore an older shallow/incorrect map.
      if (Number(saved?.version || 0) !== MAP_VERSION) return false;
      if (saved?.repoUrl !== this.state.repoUrl || saved?.commit !== this.state.commit || !saved?.semanticState) return false;
      const live = this.state;
      const prior = saved.semanticState;

      for (const key of [
        'pass1Arcs', 'pass1Scheduler', 'pass2WholeFlowByArc', 'pass2GraphByArc',
        'callPathPreprocess', 'scout', 'stories', 'threadAssignments',
        'trajectoryEvidence', 'orientation', 'unattachedFragments'
      ]) {
        if (prior[key] !== undefined) live[key] = clone(prior[key]);
      }

      live.mapPersistence = {
        restored: true,
        savedAt: saved.savedAt || '',
        repoUrl: saved.repoUrl,
        commit: saved.commit,
        version: MAP_VERSION
      };
      live.lastMessage = `Loaded the existing enterprise map for this repository revision.`;
      this._mapRestored = true;
      return true;
    } catch (error) {
      console.warn(`[lemap] could not restore semantic map: ${error.message}`);
      return false;
    }
  }

  enrichTraceability() {
    for (const arc of arr(this.state?.pass1Arcs)) {
      const callPathId = String(arc.callPathId || '');
      if (!callPathId) continue;
      const grouped = this.rankedPathById?.(callPathId)
        || this.topology.topCallPaths?.(500)?.find((item) => item.id === callPathId)
        || null;
      if (!grouped) continue;
      const compact = this.compactCallPath?.(grouped) || null;
      arc.traceability = {
        callPathId,
        variantCallPathIds: arr(arc.callPathVariantIds),
        entrySymbolId: grouped.entrySymbolId || '',
        sourcePaths: arr(grouped.sourcePaths),
        pathFingerprint: crypto.createHash('sha1').update(JSON.stringify(compact || grouped)).digest('hex')
      };
    }
  }

  closeCompletedArcs() {
    for (const arc of arr(this.state?.pass1Arcs)) {
      const flow = this.state?.pass2WholeFlowByArc?.[arc.id];
      if (!flow) continue;
      const noPendingBranches = arr(flow.pendingBranchIndexes).length === 0;
      const interpreted = Number(flow.wholeFlowCalls || 0) > 0 || Number(flow.branchCalls || 0) > 0;
      if ((flow.completed || (interpreted && noPendingBranches && Number(arc.progress || 0) >= 90)) && noPendingBranches) {
        arc.closureState = 'closed';
        arc.closureReason = flow.completed
          ? 'compressed flow fully interpreted'
          : 'high-confidence flow with no unresolved branches';
        arc.closedAt = arc.closedAt || new Date().toISOString();
        arc.progress = 100;
        if (arc.status !== 'unresolved') arc.status = 'broadly_complete';
        arc.opportunityScore = 0;
      }
    }
  }

  persistSemanticMap() {
    if (!this.state?.repoUrl || !this.state?.commit) return;
    try {
      this.closeCompletedArcs();
      this.enrichTraceability();
      const dir = this.mapDirectory();
      fs.mkdirSync(dir, { recursive: true });
      const savedAt = new Date().toISOString();
      const semanticState = clone(this.state);
      semanticState.currentArtifact = null;
      semanticState.frontier = [];
      semanticState.executionStack = [];
      semanticState.stopRequested = false;
      semanticState.status = 'saved';
      fs.writeFileSync(this.mapFilePath(), JSON.stringify({
        version: MAP_VERSION,
        repoUrl: this.state.repoUrl,
        commit: this.state.commit,
        savedAt,
        semanticState
      }, null, 2));
      this.state.mapPersistence = {
        restored: !!this._mapRestored,
        savedAt,
        repoUrl: this.state.repoUrl,
        commit: this.state.commit,
        version: MAP_VERSION
      };
    } catch (error) {
      console.warn(`[lemap] could not persist semantic map: ${error.message}`);
    }
  }

  emit() {
    if (this.state?.repoUrl && this.state?.commit && !this._mapRestoreAttempted) {
      this.restorePersistedMapIfAvailable();
    }
    if (this._stoppedByUser && this.state?.status === 'complete') {
      this.state.lastMessage = 'Stopped by user. The learned map has been saved.';
    }
    this.closeCompletedArcs();
    this.enrichTraceability();
    if (this.state?.repoUrl && this.state?.commit) this.persistSemanticMap();
    return super.emit();
  }

  applyDelta(parsed, observation) {
    const result = super.applyDelta(parsed, observation);
    this.closeCompletedArcs();
    this.enrichTraceability();
    this.persistSemanticMap();
    return result;
  }

  requestStop() {
    this._stoppedByUser = true;
    this.state.stopRequested = true;
    this.state.lastMessage = 'Stopping after the current reasoning step…';
    this.persistSemanticMap();
    super.emit();
  }

  async resolveNextAction(action, candidates) {
    if (this.state?.stopRequested) return null;
    return super.resolveNextAction(action, candidates);
  }
}
