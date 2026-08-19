import { ProgressiveRepositoryExplorerV35 } from './progressiveRepositoryExplorerV35.js';

function arr(value) { return Array.isArray(value) ? value : []; }

export class ProgressiveRepositoryExplorerV36 extends ProgressiveRepositoryExplorerV35 {
  constructor(options) {
    super(options);
    this.stopRequested = false;
  }

  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'callpath-seeds-first-pass1-pass2-compact-ui-v16';
    state.stopRequested = false;
    state.runLogFile = '';
    return state;
  }

  async run(repoUrl) {
    this.stopRequested = false;
    return super.run(repoUrl);
  }

  async startRunLog(prep) {
    await super.startRunLog(prep);
    this.state.runLogFile = String(this.runLogPath || '').split(/[\\/]/).pop() || '';
    this.emit();
  }

  requestStop() {
    this.stopRequested = true;
    this.state.stopRequested = true;
    this.state.lastMessage = 'Stopping after the current model call…';
    this.emit();
  }

  applyDelta(parsed, observation) {
    const result = super.applyDelta(parsed, observation);
    if (!parsed?._callPathPreprocess) return result;

    const cp = this.state.callPathPreprocess || {};
    const seededIds = arr(cp.seededArcIds);
    if (!seededIds.length) return result;

    const arcsById = new Map(this.pass1().arcs().map((arc) => [arc.id, arc]));

    // Project the fields where Pass1ArcScheduler actually stores seed actor and
    // confidence. V35's UI projection used businessActor/confidence properties,
    // which are not persisted on the arc itself.
    cp.seededArcs = seededIds.map((id) => arcsById.get(id)).filter(Boolean).map((arc) => ({
      arcId: arc.id,
      title: arc.title || '',
      actor: arc.trigger || '',
      intent: arc.businessIntent || '',
      confidence: Number(arc.opportunityScore || 0),
      callPathId: arc.callPathId || '',
      coherentFunctionCount: Number(arc.coherentFunctionCount || 0),
      containedCallPathIds: arr(arc.containedCallPathIds),
      status: arc.status || 'seeded'
    }));

    // A qualified deterministic flow is already a Pass-1-admitted business arc.
    // Do not run the initial broad Discovery walk before exploiting it. Schedule
    // the strongest seed now; Scout can reactivate Discovery later when Pass-2
    // semantic signal weakens or the local frontier is exhausted.
    const discovery = this.discovery().ensureState();
    discovery.status = 'complete';
    discovery.activeStartId = '';
    this._discoveryChosen = null;
    this._discoveryTransition = null;

    for (const id of seededIds) this.pass2().seed(id);
    const chosen = this.pass1().chooseNextArc(seededIds[0]);
    this.pass1().syncStories();

    if (chosen) {
      this.state.lastMessage = `Call-path preprocessing seeded ${seededIds.length} business flow${seededIds.length === 1 ? '' : 's'}; Pass 1 scheduled ${chosen.title} for Pass 2. Scout will reopen Discovery only if semantic signal weakens.`;
    }
    return result;
  }

  async resolveNextAction(action, candidates) {
    if (this.stopRequested) return null;
    return super.resolveNextAction(action, candidates);
  }
}
