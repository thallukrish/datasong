import { ProgressiveRepositoryExplorerV46 } from './progressiveRepositoryExplorerV46.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function meaningfulOutcome(value) {
  const s = String(value || '').trim();
  return !!s && !/^(no outcome|none|unknown|not evidenced)/i.test(s);
}

export class ProgressiveRepositoryExplorerV47 extends ProgressiveRepositoryExplorerV46 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'persistent-full-scout-evidence-closure-v27';
    return state;
  }

  normalizeWholeFlowPass2(raw, observation) {
    // DeepSeek occasionally returns valid JSON with arcUpdate/flowAction nested
    // under arcFit. Recover that shape instead of silently dropping useful map
    // evidence such as stages/entities/relationships.
    const fit = raw?.arcFit && typeof raw.arcFit === 'object' ? raw.arcFit : {};
    const repaired = { ...(raw || {}) };
    if ((!repaired.arcUpdate || typeof repaired.arcUpdate !== 'object') && fit.arcUpdate && typeof fit.arcUpdate === 'object') {
      repaired.arcUpdate = fit.arcUpdate;
    }
    if (!Array.isArray(repaired.unresolvedBranches) && Array.isArray(fit.unresolvedBranches)) {
      repaired.unresolvedBranches = fit.unresolvedBranches;
    }
    if (!repaired.flowAction && fit.flowAction) repaired.flowAction = fit.flowAction;
    return super.normalizeWholeFlowPass2(repaired, observation);
  }

  evidenceDepth(arc) {
    const stages = arr(arc?.majorStages);
    const entities = arr(arc?.entities);
    const persistent = arr(arc?.persistentObjects);
    const relationships = arr(arc?.relationships);
    const effects = arr(arc?.externalEffects);
    const outcome = arc?.outcome || arc?.businessOutcome || '';
    const dimensions = [
      stages.length >= 2,
      entities.length >= 2,
      persistent.length >= 1,
      relationships.length >= 1,
      effects.length >= 1
    ].filter(Boolean).length;
    return {
      stages: stages.length,
      entities: entities.length,
      persistentObjects: persistent.length,
      relationships: relationships.length,
      externalEffects: effects.length,
      hasOutcome: meaningfulOutcome(outcome),
      dimensions,
      sufficient: dimensions >= 2 || stages.length >= 3 || (entities.length >= 2 && meaningfulOutcome(outcome))
    };
  }

  closeCompletedArcs() {
    for (const arc of arr(this.state?.pass1Arcs)) {
      const flow = this.state?.pass2WholeFlowByArc?.[arc.id];
      if (!flow) continue;
      const noPendingBranches = arr(flow.pendingBranchIndexes).length === 0;
      const interpreted = Number(flow.wholeFlowCalls || 0) > 0 || Number(flow.branchCalls || 0) > 0;
      if (!interpreted || !noPendingBranches) continue;

      const depth = this.evidenceDepth(arc);
      flow.businessEvidenceDepth = depth;

      if (depth.sufficient && flow.completed) {
        arc.closureState = 'closed';
        arc.closureReason = 'compressed path interpreted with sufficient business evidence';
        arc.closedAt = arc.closedAt || new Date().toISOString();
        arc.progress = 100;
        if (arc.status !== 'unresolved') arc.status = 'broadly_complete';
        arc.opportunityScore = 0;
      } else if (flow.completed) {
        // The executable path has been interpreted, but that does not mean the
        // business workflow itself is understood. Keep the path retired while
        // making the semantic incompleteness explicit in the map/UI.
        arc.closureState = 'needs_more_evidence';
        arc.closureReason = 'path interpreted but insufficient business stages/entities/relationships were evidenced';
        arc.progress = Math.min(Number(arc.progress || 0), 60);
        arc.status = 'unresolved';
        arc.opportunityScore = 0;
      }
    }
  }
}
