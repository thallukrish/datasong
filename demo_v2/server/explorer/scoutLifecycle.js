import { ScoutLayerV2 } from '../scoutLayerV2.js';

export const withScoutLifecycle = (Base) => class ScoutLifecycleExplorer extends Base {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'callgraph-whole-flow-scout-unseen-paths-v24';
    return state;
  }

  scout() {
    if (!this._scoutLayerV2) this._scoutLayerV2 = new ScoutLayerV2(this);
    this._scoutLayerV2.ensureState();
    return this._scoutLayerV2;
  }

  async scoutForNextArc() {
    const scout = this.scout();
    while (true) {
      const broad = scout.broadCandidates();
      if (!broad.length) {
        scout.ensureState().pendingReason = '';
        return null;
      }
      if (!scout.ensureState().pendingReason) {
        scout.ensureState().pendingReason = 'all currently admitted business arcs are interpreted; scan unseen call paths for a missing business use case';
      }
      if (!scout.shouldRun(broad)) {
        for (const candidate of broad) {
          for (const id of candidate.callPathIds || []) {
            if (!scout.ensureState().reviewedCallPathIds.includes(id)) scout.ensureState().reviewedCallPathIds.push(id);
          }
        }
        scout.ensureState().pendingReason = 'continue scanning lower-ranked unseen call paths';
        continue;
      }
      const chosen = await this.runScout(broad);
      if (chosen?.arc) {
        const arc = chosen.arc;
        const flow = this.flowState(arc);
        if (flow) {
          flow.started = false;
          flow.completed = false;
          flow.pendingBranchIndexes = [];
          flow.interpretedBranchIndexes = [];
        }
        this.state.lastMessage = `Scout found ${arc.title}; Pass 1 admitted it and Pass 2 will interpret its compressed flow.`;
        this.pass1().syncStories();
        return arc;
      }
      scout.ensureState().pendingReason = 'continue scanning lower-ranked unseen call paths for a missing business use case';
    }
  }

  async resolveNextAction(action, candidates) {
    const normal = await super.resolveNextAction(action, candidates);
    if (normal) return normal;
    const arc = await this.scoutForNextArc();
    if (!arc) {
      this.state.lastMessage = 'All admitted arcs are interpreted and Scout found no additional business-use-case direction in unseen call paths.';
      return null;
    }
    const observation = await this.resumePass2Arc(arc.id);
    if (observation) return observation;
    const flow = this.flowState(arc);
    if (flow) flow.completed = true;
    arc.status = 'unresolved';
    arc.opportunityScore = 0;
    return this.resolveNextAction(action, candidates);
  }
};
