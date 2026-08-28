const arr = (value) => Array.isArray(value) ? value : [];

function isClosed(arc) {
  return arc?.closureState === 'closed';
}

export const withPersistedWorkflowResumeGuard = (Base) => class PersistedWorkflowResumeGuardExplorer extends Base {
  pass1() {
    const scheduler = super.pass1();
    if (scheduler.__closedWorkflowGuardInstalled) return scheduler;

    const originalArcBoard = scheduler.arcBoard.bind(scheduler);
    const originalActiveArc = scheduler.activeArc.bind(scheduler);
    const originalSelectEvidenceArc = scheduler.selectEvidenceArc.bind(scheduler);
    const originalChooseNextArc = scheduler.chooseNextArc.bind(scheduler);

    scheduler.arcBoard = () => originalArcBoard().filter((item) => {
      const arc = scheduler.arcByReference(item?.id);
      return arc && !isClosed(arc);
    });

    scheduler.activeArc = () => {
      const arc = originalActiveArc();
      return arc && !isClosed(arc) ? arc : null;
    };

    scheduler.selectEvidenceArc = (parsed) => {
      const arc = originalSelectEvidenceArc(parsed);
      return arc && !isClosed(arc) ? arc : null;
    };

    scheduler.chooseNextArc = (preferredArcId = '') => {
      const preferred = scheduler.arcByReference(preferredArcId);
      const safePreferredArcId = preferred && isClosed(preferred) ? '' : preferredArcId;
      const chosen = originalChooseNextArc(safePreferredArcId);
      if (chosen && !isClosed(chosen)) return chosen;

      const next = this.unfinishedWholeFlowArcs?.('')?.[0] || null;
      const state = scheduler.ensureState();
      state.activeArcId = next?.id || '';
      if (next) next.lastScheduledStep = Number(this.state?.step || 0);
      return next;
    };

    Object.defineProperty(scheduler, '__closedWorkflowGuardInstalled', { value:true, enumerable:false });
    return scheduler;
  }

  unfinishedWholeFlowArcs(excludeArcId = '') {
    return super.unfinishedWholeFlowArcs(excludeArcId)
      .filter((arc) => arc?.id && !isClosed(arc));
  }

  repairPersistedWorkflowScheduling() {
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
    const scheduler = this.pass1();
    scheduler.ensureState().activeArcId = next?.id || '';
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
  }

  installPersistedMap(saved) {
    const snapshot = super.installPersistedMap(saved);
    if (!snapshot) return snapshot;
    this.repairPersistedWorkflowScheduling();
    return this.snapshot();
  }

  restorePersistedMapIfAvailable() {
    const restored = super.restorePersistedMapIfAvailable();
    if (restored) this.repairPersistedWorkflowScheduling();
    return restored;
  }
};
