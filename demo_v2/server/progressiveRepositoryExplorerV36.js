import { ProgressiveRepositoryExplorerV35 } from './progressiveRepositoryExplorerV35.js';

export class ProgressiveRepositoryExplorerV36 extends ProgressiveRepositoryExplorerV35 {
  constructor(options) {
    super(options);
    this.stopRequested = false;
  }

  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'parallel-callpath-pass1-pass2-compact-ui-v16';
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

  async resolveNextAction(action, candidates) {
    if (this.stopRequested) return null;
    return super.resolveNextAction(action, candidates);
  }
}
