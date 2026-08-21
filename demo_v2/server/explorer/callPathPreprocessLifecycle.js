export const withCallPathPreprocessLifecycle = (Base) => class CallPathPreprocessLifecycleExplorer extends Base {
  emptyState() {
    const state = super.emptyState();
    state.callPathPreprocess = state.callPathPreprocess || {
      status: 'pending',
      reviewedPathIds: [],
      classifications: [],
      seededArcIds: []
    };
    return state;
  }

  callPathPending() {
    return this.state?.callPathPreprocess?.status === 'pending'
      && typeof this.topology?.topCallPaths === 'function'
      && this.topology.topCallPaths(10).length > 0;
  }

  buildPrompt(observation, candidates) {
    if (this.callPathPending()) return this.callPathPrompt();
    return super.buildPrompt(observation, candidates);
  }
};
