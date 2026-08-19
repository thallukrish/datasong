import { ProgressiveRepositoryExplorerV42 } from './progressiveRepositoryExplorerV42.js';

function arr(value) { return Array.isArray(value) ? value : []; }

export class ProgressiveRepositoryExplorerV43 extends ProgressiveRepositoryExplorerV42 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'callgraph-whole-flow-pass1-completion-scheduler-v23';
    return state;
  }

  unfinishedWholeFlowArcs(excludeArcId = '') {
    return this.pass1().arcs()
      .filter((arc) => arc?.id && arc.id !== excludeArcId)
      .filter((arc) => {
        const flow = this.flowState(arc);
        return !flow?.completed;
      })
      .sort((a, b) => {
        const aStarted = this.flowState(a)?.started ? 1 : 0;
        const bStarted = this.flowState(b)?.started ? 1 : 0;
        if (aStarted !== bStarted) return aStarted - bStarted;
        return Number(b.opportunityScore || 0) - Number(a.opportunityScore || 0)
          || Number(a.createdStep || 0) - Number(b.createdStep || 0);
      });
  }

  scheduleNextWholeFlow(completedArcId = '') {
    const scheduler = this.pass1().ensureState();
    const completed = completedArcId ? this.pass1().arcByReference(completedArcId) : null;
    if (completed) {
      // Completion of the deterministic whole-flow interpretation is definitive
      // for Pass-2 scheduling. Do not let stale fit/opportunity reselect it.
      completed.status = 'broadly_complete';
      completed.opportunityScore = 0;
      completed.progress = Math.max(Number(completed.progress || 0), 90);
    }

    const next = this.unfinishedWholeFlowArcs(completedArcId)[0] || null;
    scheduler.activeArcId = next?.id || '';
    if (next) {
      next.lastScheduledStep = Number(this.state.step || 0);
      scheduler.decisions.push({
        step: Number(this.state.step || 0),
        fromArcId: completedArcId || '',
        toArcId: next.id,
        priority: Number(next.opportunityScore || 0),
        reason: 'previous whole-flow arc completed; schedule next uninterpreted Pass-1 arc'
      });
      scheduler.decisions = scheduler.decisions.slice(-300);
      this.state.lastMessage = `Pass 1 completed ${completed?.title || completedArcId}; scheduling ${next.title}.`;
      this._wholeFlowNextArcId = next.id;
    } else {
      this._wholeFlowNextArcId = '';
      this.state.lastMessage = completed
        ? `Pass 1 completed ${completed.title}; all currently admitted arcs have been interpreted.`
        : 'All currently admitted arcs have been interpreted.';
    }
    this.pass1().syncStories();
    return next;
  }

  applyDelta(parsed, observation) {
    const evidenceArcId = parsed?._wholeFlowPass2 ? String(parsed?.arcUpdate?.arcId || this.pass1().activeArcId() || '') : '';
    const result = super.applyDelta(parsed, observation);

    if (!parsed?._wholeFlowPass2 || !evidenceArcId) return result;
    const flow = this.flowState(this.pass1().arcByReference(evidenceArcId));
    if (flow?.completed) this.scheduleNextWholeFlow(evidenceArcId);
    return result;
  }

  async resolveNextAction(action, candidates) {
    if (this._wholeFlowNextArcId) {
      const nextId = this._wholeFlowNextArcId;
      this._wholeFlowNextArcId = '';
      const observation = await this.resumePass2Arc(nextId);
      if (observation) return observation;
      // If this arc could not produce a deterministic flow package, retire it
      // from this scheduler turn and immediately try another admitted arc.
      const flow = this.flowState(this.pass1().arcByReference(nextId));
      if (flow) flow.completed = true;
      this.scheduleNextWholeFlow(nextId);
      if (this._wholeFlowNextArcId) return this.resolveNextAction(action, candidates);
    }

    const active = this.pass1().activeArc();
    if (active) {
      const flow = this.flowState(active);
      if (!flow?.completed) {
        const observation = await this.resumePass2Arc(active.id);
        if (observation) return observation;
      }
    }

    // Only now may the legacy outer loop see null: there are no admitted arcs
    // left that Pass 2 has not interpreted. The repository frontier is no longer
    // the completion criterion for indexed business flows.
    return super.resolveNextAction(action, candidates);
  }
}
