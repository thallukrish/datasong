const arr = (value) => Array.isArray(value) ? value : [];

function isClosed(arc) {
  return arc?.closureState === 'closed';
}

export const withPersistedWorkflowResumeGuard = (Base) => class PersistedWorkflowResumeGuardExplorer extends Base {
  unfinishedWholeFlowArcs(excludeArcId = '') {
    return super.unfinishedWholeFlowArcs(excludeArcId)
      .filter((arc) => arc?.id && !isClosed(arc));
  }

  installPersistedMap(saved) {
    const snapshot = super.installPersistedMap(saved);
    if (!snapshot) return snapshot;

    // Persisted graph closure is authoritative. Pass-2 flow state is transient and
    // may not exist after a v3 restore, so reconstruct completion from the graph.
    for (const arc of arr(this.state?.pass1Arcs)) {
      if (!isClosed(arc)) continue;
      const flow = this.flowState?.(arc);
      if (flow) {
        flow.started = true;
        flow.completed = true;
        flow.pendingBranchIndexes = [];
      }
    }

    const next = this.unfinishedWholeFlowArcs('')[0] || null;
    const scheduler = this.pass1?.().ensureState?.() || this.state?.pass1Scheduler;
    if (scheduler) scheduler.activeArcId = next?.id || '';
    this._wholeFlowNextArcId = next?.id || '';

    if (next) {
      const flow = this.flowState?.(next);
      if (flow) flow.completed = false;
      this.state.lastMessage = `Loaded persisted map; resuming incomplete workflow ${next.title}.`;
    } else {
      this.state.lastMessage = 'Loaded persisted map; no incomplete admitted workflow remains.';
    }

    const incomplete = arr(this.state?.pass1Arcs).filter((arc) => !isClosed(arc));
    const partial = incomplete.filter((arc) => Number(arc?.progress || 0) > 0).length;
    const zero = incomplete.filter((arc) => Number(arc?.progress || 0) === 0).length;
    console.log(`[lemap restore] closed ${arr(this.state?.pass1Arcs).length - incomplete.length}; incomplete ${incomplete.length}; partial ${partial}; zero ${zero}; active ${next?.title || 'none'}`);
    return this.snapshot();
  }
};
