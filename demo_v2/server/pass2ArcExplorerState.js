function clone(value) { return JSON.parse(JSON.stringify(value)); }
function arr(value) { return Array.isArray(value) ? value : []; }

const KEYS = [
  'executionStack',
  'frontier',
  'visited',
  'branchSignalTrail',
  'flattenedBranches',
  'semanticEscapes'
];

export class Pass2ArcExplorerState {
  constructor(explorer) { this.explorer = explorer; }

  ensureState() {
    const state = this.explorer.state;
    if (!state.pass2DfsByArc) state.pass2DfsByArc = {};
    return state.pass2DfsByArc;
  }

  snapshotCurrent() {
    const state = this.explorer.state;
    const out = {};
    for (const key of KEYS) out[key] = clone(state[key] || []);
    out.currentObservationId = this.explorer._currentObservationId || '';
    out.activeNeighborhoodAnchorId = this.explorer._activeNeighborhoodAnchorId || '';
    out.savedStep = state.step;
    return out;
  }

  capture(arcId) {
    if (!arcId) return;
    const map = this.ensureState();
    map[arcId] = this.snapshotCurrent();
  }

  seed(arcId) {
    if (!arcId) return;
    const map = this.ensureState();
    if (!map[arcId]) map[arcId] = this.snapshotCurrent();
  }

  restore(arcId) {
    if (!arcId) return false;
    const map = this.ensureState();
    const saved = map[arcId];
    if (!saved) return false;
    const state = this.explorer.state;
    for (const key of KEYS) state[key] = clone(saved[key] || []);
    this.explorer._currentObservationId = saved.currentObservationId || '';
    this.explorer._activeNeighborhoodAnchorId = saved.activeNeighborhoodAnchorId || '';
    return true;
  }

  switch(fromArcId, toArcId) {
    if (fromArcId) this.capture(fromArcId);
    if (!toArcId) return false;
    if (!this.restore(toArcId)) {
      // A newly discovered arc starts from the current evidence/DFS context.
      // Capture after the previous arc has been saved so it receives an
      // independent copy rather than sharing mutable arrays.
      this.seed(toArcId);
      this.restore(toArcId);
    }
    return true;
  }

  bestPendingCandidate(arcId) {
    if (!arcId) return null;
    const saved = this.ensureState()[arcId];
    if (!saved) return null;
    const visited = new Set(arr(saved.visited));
    const frontier = new Map(arr(saved.frontier).map((item) => [item.id, item]));
    for (let i = arr(saved.executionStack).length - 1; i >= 0; i -= 1) {
      const frame = saved.executionStack[i];
      const ids = arr(frame.semanticPendingIds).length ? frame.semanticPendingIds : arr(frame.candidateIds);
      const candidates = ids
        .filter((id) => !visited.has(id))
        .map((id) => frontier.get(id))
        .filter(Boolean);
      if (candidates.length) return candidates[0];
    }
    return null;
  }
}
