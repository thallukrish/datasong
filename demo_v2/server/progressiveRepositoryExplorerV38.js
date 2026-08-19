import { ProgressiveRepositoryExplorerV37 } from './progressiveRepositoryExplorerV37.js';

function arr(value) { return Array.isArray(value) ? value : []; }

export class ProgressiveRepositoryExplorerV38 extends ProgressiveRepositoryExplorerV37 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'callpaths-pass1-pass2-seed-local-start-v18';
    return state;
  }

  attachDeterministicSeedStarts() {
    const byPath = new Map(
      (typeof this.topology?.topCallPaths === 'function' ? this.topology.topCallPaths(10) : [])
        .map((path) => [path.id, path])
    );
    for (const arc of this.pass1().arcs()) {
      if (arc.seedSource !== 'call_path_preprocessor' || !arc.callPathId) continue;
      const path = byPath.get(arc.callPathId);
      if (!path) continue;
      arc.seedArtifactId = path.entrySymbolId || '';
      arc.seedSourcePath = arr(path.sourcePaths)[0] || '';
      arc.seedStarted = false;
      // The older Pass-2 seed was a clone of the repository/root DFS state.
      // Remove it. This arc must start from its own deterministic entry point.
      if (this.state.pass2DfsByArc) delete this.state.pass2DfsByArc[arc.id];
    }
  }

  async startArcAtSeed(arc) {
    if (!arc?.seedArtifactId || arc.seedStarted) return null;
    arc.seedStarted = true;

    // A deterministic arc gets a clean local DFS world. It must not inherit
    // root/data/jmeter frontier state from repository orientation.
    this.state.executionStack = [];
    this.state.frontier = [];
    this.state.branchSignalTrail = [];
    this.state.flattenedBranches = [];
    this.state.semanticEscapes = [];
    this._currentObservationId = '';
    this._activeNeighborhoodAnchorId = '';

    this.state.lastMessage = `Pass 2 starting ${arc.title} at its deterministic call-path seed.`;
    this.pass1().syncStories();
    this.emit?.();

    if (this.topology.symbolById?.has(arc.seedArtifactId)) {
      return this.topology.getFunction(arc.seedArtifactId);
    }
    return this.topology.getArtifact(arc.seedArtifactId);
  }

  applyDelta(parsed, observation) {
    const result = super.applyDelta(parsed, observation);
    if (!parsed?._callPathPreprocess) return result;

    this.attachDeterministicSeedStarts();
    const seededIds = arr(this.state.callPathPreprocess?.seededArcIds);
    const chosen = this.pass1().chooseNextArc(seededIds[0] || '');
    if (chosen) {
      this._pendingSeedArcId = chosen.id;
      this.state.lastMessage = `Pass 1 scheduled ${chosen.title}; Pass 2 will start at ${chosen.seedArtifactId || 'its deterministic seed'}.`;
      this.pass1().syncStories();
    }
    return result;
  }

  async resumePass2Arc(arcId) {
    const arc = this.pass1().arcByReference(arcId);
    const seeded = await this.startArcAtSeed(arc);
    if (seeded) return seeded;
    return super.resumePass2Arc(arcId);
  }

  async resolveNextAction(action, candidates) {
    if (this._pendingSeedArcId) {
      const arc = this.pass1().arcByReference(this._pendingSeedArcId);
      this._pendingSeedArcId = '';
      const seeded = await this.startArcAtSeed(arc);
      if (seeded) return seeded;
    }
    return super.resolveNextAction(action, candidates);
  }
}
