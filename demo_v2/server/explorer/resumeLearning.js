const arr = (value) => Array.isArray(value) ? value : [];
const clone = (value) => JSON.parse(JSON.stringify(value));

function defaultFlowState() {
  return { started:false, completed:false, pendingBranchIndexes:[], interpretedBranchIndexes:[], wholeFlowCalls:0, branchCalls:0 };
}

export const withResumeLearning = (Base) => class ResumeLearningExplorer extends Base {
  capturePass2Checkpoints() {
    const flows = this.state?.pass2WholeFlowByArc || {};
    for (const arc of arr(this.state?.pass1Arcs)) {
      if (!arc?.id || arc.closureState === 'closed') {
        if (arc?.pass2Checkpoint) delete arc.pass2Checkpoint;
        continue;
      }
      const flow = flows[arc.id];
      if (flow) arc.pass2Checkpoint = clone(flow);
    }
  }

  restorePass2Checkpoints() {
    if (!this.state.pass2WholeFlowByArc) this.state.pass2WholeFlowByArc = {};
    const flows = this.state.pass2WholeFlowByArc;
    for (const arc of arr(this.state?.pass1Arcs)) {
      if (!arc?.id) continue;
      if (arc.closureState === 'closed') {
        flows[arc.id] = {
          ...defaultFlowState(),
          ...(flows[arc.id] || {}),
          started:true,
          completed:true,
          pendingBranchIndexes:[]
        };
        continue;
      }
      const checkpoint = arc.pass2Checkpoint;
      if (checkpoint && typeof checkpoint === 'object') {
        flows[arc.id] = { ...defaultFlowState(), ...clone(checkpoint) };
      } else if (!flows[arc.id]) {
        flows[arc.id] = defaultFlowState();
      }
    }

    const eligible = this.unfinishedWholeFlowArcs?.('') || [];
    const activeId = String(this.state?.pass1Scheduler?.activeArcId || '');
    const active = arr(this.state?.pass1Arcs).find((arc) => arc?.id === activeId);
    if (!active || active.closureState === 'closed' || flows[activeId]?.completed) {
      if (this.state?.pass1Scheduler) this.state.pass1Scheduler.activeArcId = eligible[0]?.id || '';
    }

    const partial = eligible.filter((arc) => Number(arc.progress || 0) > 0).length;
    const zero = eligible.filter((arc) => Number(arc.progress || 0) === 0).length;
    console.log(`[lemap learn resume] eligible ${eligible.length}; partial ${partial}; zero ${zero}; next ${eligible[0]?.title || 'none'}`);
  }

  installPersistedMap(saved) {
    const result = super.installPersistedMap(saved);
    if (result) this.restorePass2Checkpoints();
    return result ? this.snapshot() : result;
  }

  restorePersistedMapIfAvailable() {
    const restored = super.restorePersistedMapIfAvailable();
    if (restored) this.restorePass2Checkpoints();
    return restored;
  }

  persistSemanticMap() {
    this.capturePass2Checkpoints();
    return super.persistSemanticMap();
  }

  unfinishedWholeFlowArcs(excludeArcId = '') {
    const base = super.unfinishedWholeFlowArcs(excludeArcId)
      .filter((arc) => arc?.closureState !== 'closed' && !this.flowState(arc)?.completed);
    return base.sort((a, b) => {
      const aPartial = Number(a.progress || 0) > 0 ? 1 : 0;
      const bPartial = Number(b.progress || 0) > 0 ? 1 : 0;
      if (aPartial !== bPartial) return bPartial - aPartial;
      if (aPartial && Number(a.progress || 0) !== Number(b.progress || 0)) return Number(b.progress || 0) - Number(a.progress || 0);
      return 0;
    });
  }
};
