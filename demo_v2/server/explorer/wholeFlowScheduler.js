export const withWholeFlowScheduler = (Base) => class WholeFlowSchedulerExplorer extends Base {
  scheduleNextWholeFlow(completedArcId = '') {
    const scheduler = this.pass1().ensureState();
    const completed = completedArcId ? this.pass1().arcByReference(completedArcId) : null;
    if (completed) {
      completed.status = 'broadly_complete';
      completed.opportunityScore = 0;
      completed.progress = Math.max(Number(completed.progress || 0), 90);
    }

    // Intentionally dispatch to the current composition's implementation.
    // The newer business-priority module owns unfinishedWholeFlowArcs ordering.
    const next = this.unfinishedWholeFlowArcs(completedArcId)[0] || null;
    scheduler.activeArcId = next?.id || '';
    if (next) {
      next.lastScheduledStep = Number(this.state.step || 0);
      scheduler.decisions.push({
        step: Number(this.state.step || 0),
        fromArcId: completedArcId || '',
        toArcId: next.id,
        priority: Number.isFinite(Number(next.businessPriority)) ? Number(next.businessPriority) : Number(next.opportunityScore || 0),
        reason: 'previous whole-flow arc completed; schedule next uninterpreted admitted business workflow'
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
    const evidenceArcId = parsed?._wholeFlowPass2
      ? String(parsed?.arcUpdate?.arcId || this.pass1().activeArcId() || '')
      : '';
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
    return super.resolveNextAction(action, candidates);
  }
};
