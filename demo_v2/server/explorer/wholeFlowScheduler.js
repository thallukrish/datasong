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
        ? `Pass 1 completed ${completed.title}; all currently admitted arcs with executable flow evidence have been interpreted.`
        : 'All currently admitted arcs with executable flow evidence have been interpreted.';
    }
    this.pass1().syncStories();
    return next;
  }

  deferArcWithoutFlow(arc) {
    if (!arc) return;
    const flow = this.flowState(arc);
    if (flow) {
      flow.started = false;
      flow.completed = false;
      flow.pendingBranchIndexes = [];
    }
    arc.pass2Unavailable = true;
    arc.status = 'unresolved';
    arc.closureState = 'needs_call_path';
    arc.closureReason = 'no recoverable deterministic compressed call path is currently available';
    arc.opportunityScore = 0;
    console.log(`[lemap learn] defer ${arc.title}: no recoverable compressed call path; leaving incomplete`);
  }

  scheduleNextRunnable(excludeArcId = '') {
    const scheduler = this.pass1().ensureState();
    const next = this.unfinishedWholeFlowArcs(excludeArcId).find((arc) => !arc.pass2Unavailable) || null;
    scheduler.activeArcId = next?.id || '';
    this._wholeFlowNextArcId = next?.id || '';
    if (next) {
      next.lastScheduledStep = Number(this.state.step || 0);
      this.state.lastMessage = `Scheduling ${next.title}.`;
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
    while (this._wholeFlowNextArcId) {
      const nextId = this._wholeFlowNextArcId;
      this._wholeFlowNextArcId = '';
      const arc = this.pass1().arcByReference(nextId);
      const observation = await this.resumePass2Arc(nextId);
      if (observation) return observation;

      const flow = this.flowState(arc);
      if (flow?.completed) {
        this.scheduleNextWholeFlow(nextId);
        continue;
      }

      // No deterministic compressed flow could be produced. This is not
      // completion; leave the workflow incomplete and continue with another
      // runnable admitted workflow.
      this.deferArcWithoutFlow(arc);
      this.scheduleNextRunnable(nextId);
    }

    const active = this.pass1().activeArc();
    if (active) {
      const flow = this.flowState(active);
      if (!flow?.completed && !active.pass2Unavailable) {
        const observation = await this.resumePass2Arc(active.id);
        if (observation) return observation;
        if (!flow?.completed) {
          this.deferArcWithoutFlow(active);
          this.scheduleNextRunnable(active.id);
          if (this._wholeFlowNextArcId) return this.resolveNextAction(action, candidates);
        }
      }
    }
    return super.resolveNextAction(action, candidates);
  }
};
