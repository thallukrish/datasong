const arr = (value) => Array.isArray(value) ? value : [];

const SEMANTIC_STATUSES = new Set(['forming', 'broadly_complete', 'unresolved']);

export const withSemanticCompletionGuard = (Base) => class SemanticCompletionGuardExplorer extends Base {
  applyDelta(parsed, observation) {
    if (parsed?._wholeFlowPass2) {
      const arcId = String(parsed?.arcUpdate?.arcId || this.pass1?.().activeArcId?.() || '');
      const arc = this.pass1?.().arcByReference?.(arcId);
      const semanticStatus = String(parsed?.arcUpdate?.status || '');
      if (arc && SEMANTIC_STATUSES.has(semanticStatus)) arc._pass2SemanticStatus = semanticStatus;
    }
    return super.applyDelta(parsed, observation);
  }

  closeCompletedArcs() {
    for (const arc of arr(this.state?.pass1Arcs)) {
      const flow = this.state?.pass2WholeFlowByArc?.[arc.id];
      if (!flow) continue;
      const noPendingBranches = arr(flow.pendingBranchIndexes).length === 0;
      const interpreted = Number(flow.wholeFlowCalls || 0) > 0 || Number(flow.branchCalls || 0) > 0;
      if (!interpreted || !noPendingBranches || !flow.completed) continue;

      // Keep evidence depth as a diagnostic only. A simple, legitimate business
      // workflow may have one executable step and one entity; structural size must
      // not veto the model's semantic completion judgment.
      if (typeof this.evidenceDepth === 'function') flow.businessEvidenceDepth = this.evidenceDepth(arc);

      if (arc._pass2SemanticStatus === 'broadly_complete') {
        arc.closureState = 'closed';
        arc.closureReason = 'compressed flow fully interpreted and semantically complete';
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
