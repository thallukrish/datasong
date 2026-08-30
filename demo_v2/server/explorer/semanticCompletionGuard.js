const arr = (value) => Array.isArray(value) ? value : [];

const SEMANTIC_STATUSES = new Set(['forming', 'broadly_complete', 'unresolved']);

export const withSemanticCompletionGuard = (Base) => class SemanticCompletionGuardExplorer extends Base {
  persistSemanticMap() {
    if (this._deferPersistenceDuringApply) return;
    return super.persistSemanticMap();
  }

  applyDelta(parsed, observation) {
    const isWholeFlow = !!parsed?._wholeFlowPass2;
    const arcId = isWholeFlow
      ? String(parsed?.arcUpdate?.arcId || this.pass1?.().activeArcId?.() || '')
      : '';

    if (isWholeFlow) {
      const arc = this.pass1?.().arcByReference?.(arcId);
      const semanticStatus = String(parsed?.arcUpdate?.status || '');
      if (arc) {
        if (SEMANTIC_STATUSES.has(semanticStatus)) arc._pass2SemanticStatus = semanticStatus;
        arc._pass2FlowAction = String(parsed?.flowAction || '');
        arc._pass2UnresolvedBranchCount = arr(parsed?.unresolvedBranches).length;
      }
    }

    const started = Date.now();
    this._deferPersistenceDuringApply = true;
    try {
      return super.applyDelta(parsed, observation);
    } finally {
      this._deferPersistenceDuringApply = false;
      if (isWholeFlow) {
        const arc = this.pass1?.().arcByReference?.(arcId);
        const next = this.pass1?.().activeArc?.();
        console.log(`[lemap learn apply] ${arc?.title || arcId || 'workflow'} applied in ${Date.now() - started}ms | progress ${Number(arc?.progress || 0)}% | closure ${arc?.closureState || 'open'} | next ${next?.title || 'none'}`);
      }
    }
  }

  closeCompletedArcs() {
    for (const arc of arr(this.state?.pass1Arcs)) {
      const flow = this.state?.pass2WholeFlowByArc?.[arc.id];
      if (!flow) continue;
      const noPendingBranches = arr(flow.pendingBranchIndexes).length === 0;
      const interpreted = Number(flow.wholeFlowCalls || 0) > 0 || Number(flow.branchCalls || 0) > 0;
      if (!interpreted || !noPendingBranches || !flow.completed) continue;

      // Keep evidence depth as a diagnostic only. Structural size must not veto
      // a model judgment that the supplied deterministic whole flow was consumed.
      if (typeof this.evidenceDepth === 'function') flow.businessEvidenceDepth = this.evidenceDepth(arc);

      const explicitlyUnresolved = arc._pass2SemanticStatus === 'unresolved'
        || Number(arc._pass2UnresolvedBranchCount || 0) > 0;
      const wholeFlowComplete = arc._pass2FlowAction === 'complete';
      const semanticallyComplete = arc._pass2SemanticStatus === 'broadly_complete'
        || (wholeFlowComplete && !explicitlyUnresolved);

      if (semanticallyComplete) {
        arc.closureState = 'closed';
        arc.closureReason = wholeFlowComplete
          ? 'deterministic compressed flow fully interpreted with no unresolved branches'
          : 'compressed flow fully interpreted and semantically complete';
        arc.closedAt = arc.closedAt || new Date().toISOString();
        arc.progress = 100;
        arc.status = 'broadly_complete';
        arc.opportunityScore = 0;
        delete arc.pass2Checkpoint;
      } else {
        arc.closureState = 'needs_more_evidence';
        arc.closureReason = 'compressed flow interpreted but semantic completion was not established';
        arc.progress = Math.min(Number(arc.progress || 0), 60);
        arc.status = 'unresolved';
      }
    }
  }
};
