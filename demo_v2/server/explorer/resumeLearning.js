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

      // A previous run may have been unable to recover a deterministic call path.
      // Retry that lookup on every fresh restore because the path index/lookup code
      // may now be able to resolve persisted variant/contained/related path ids.
      delete arc.pass2Unavailable;
      if (arc.closureState === 'needs_call_path') arc.closureState = '';

      // Runtime Pass-2 state is not durable semantic truth. If a workflow is still
      // incomplete after restore, restart its bounded compressed-flow interpretation
      // rather than preserving started=true/completed=true and silently skipping it.
      const checkpoint = arc.pass2Checkpoint && typeof arc.pass2Checkpoint === 'object'
        ? clone(arc.pass2Checkpoint)
        : {};
      flows[arc.id] = {
        ...defaultFlowState(),
        wholeFlowCalls:Number(checkpoint.wholeFlowCalls || 0),
        branchCalls:Number(checkpoint.branchCalls || 0),
        started:false,
        completed:false,
        pendingBranchIndexes:[],
        interpretedBranchIndexes:[]
      };
    }

    const eligible = this.unfinishedWholeFlowArcs?.('') || [];
    if (this.state?.pass1Scheduler) this.state.pass1Scheduler.activeArcId = eligible[0]?.id || '';
    this._wholeFlowNextArcId = eligible[0]?.id || '';

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
      .filter((arc) => arc?.closureState !== 'closed' && !arc?.pass2Unavailable && !this.flowState(arc)?.completed);
    return base.sort((a, b) => {
      const aPartial = Number(a.progress || 0) > 0 ? 1 : 0;
      const bPartial = Number(b.progress || 0) > 0 ? 1 : 0;
      if (aPartial !== bPartial) return bPartial - aPartial;
      if (aPartial && Number(a.progress || 0) !== Number(b.progress || 0)) return Number(b.progress || 0) - Number(a.progress || 0);
      return 0;
    });
  }
};
