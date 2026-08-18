import { ProgressiveRepositoryExplorerV22 } from './progressiveRepositoryExplorerV22.js';

function arr(value) { return Array.isArray(value) ? value : []; }

export class ProgressiveRepositoryExplorerV23 extends ProgressiveRepositoryExplorerV22 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'pass1-admission-prearc-explorer-pass2-per-arc-dfs-v3';
    state.preAdmissionExploration = { steps: [] };
    return state;
  }

  hasAdmittedArc() {
    return this.pass1().arcs().length > 0;
  }

  recordPreAdmission(request, chosenId = '') {
    if (!this.state.preAdmissionExploration) this.state.preAdmissionExploration = { steps: [] };
    this.state.preAdmissionExploration.steps.push({
      step: this.state.step,
      fromArtifactId: this._currentObservationId || '',
      requestType: request?.type || '',
      requestedArtifactId: request?.artifactId || '',
      chosenArtifactId: chosenId,
      query: request?.query || '',
      reason: request?.reason || ''
    });
    this.state.preAdmissionExploration.steps = this.state.preAdmissionExploration.steps.slice(-120);
  }

  async resolvePreAdmission(request, candidates) {
    const action = request && typeof request === 'object' ? { ...request } : { type: 'advance' };
    this.normalizeSemanticSourceContainerRequest(action);
    this.normalizeTypedArtifactRequest(action, null, candidates);

    // Before a business-use-case arc is admitted there is deliberately no Pass-2
    // DFS. Follow the model's requested evidence directly so hypotheses can gain
    // enough evidence to be admitted or rejected.
    if (action.type === 'advance') {
      const requested = arr(candidates).find((candidate) => candidate?.id === action.artifactId && !this.state.visited.includes(candidate.id));
      const chosen = requested || arr(candidates).find((candidate) => candidate?.id && !this.state.visited.includes(candidate.id));
      if (chosen) {
        this.removeFrontier(chosen.id);
        this.recordTraversalEdge(this._currentObservationId || '', chosen.id, chosen.relation || 'pre_admission_advance', 'traversed');
        this.recordPreAdmission(action, chosen.id);
        return this.topology.getArtifact(chosen.id);
      }
      // No local candidate: continue repository discovery rather than declaring
      // the run complete merely because no arc has yet been admitted.
      const fallback = this.state.frontier.find((candidate) => candidate?.id && !this.state.visited.includes(candidate.id));
      if (fallback) {
        this.removeFrontier(fallback.id);
        this.recordTraversalEdge(this._currentObservationId || '', fallback.id, fallback.relation || 'pre_admission_frontier', 'traversed');
        this.recordPreAdmission(action, fallback.id);
        return this.topology.getArtifact(fallback.id);
      }
      this.recordPreAdmission(action, '');
      return null;
    }

    if (action.type === 'searchSemantic') {
      const hits = arr(await this.topology.searchSemantic(action.query)).filter((hit) => hit?.id && !this.state.visited.includes(hit.id));
      if (hits.length) {
        this.recordPreAdmission(action, hits[0].id);
        return {
          id: `pre-admission-search:${encodeURIComponent(action.query || '')}:${this.state.step}`,
          path: action.query || '',
          kind: 'semantic_neighborhood',
          summary: `Pre-admission evidence search for ${action.query || 'business-use-case evidence'}`,
          canonical: { kind: 'semantic_search_results', query: action.query || '', phase: 'pre_admission' },
          neighbors: hits,
          sourceCoverage: null
        };
      }
      const fallback = this.state.frontier.find((candidate) => candidate?.id && !this.state.visited.includes(candidate.id));
      if (fallback) {
        this.removeFrontier(fallback.id);
        this.recordPreAdmission(action, fallback.id);
        return this.topology.getArtifact(fallback.id);
      }
      return null;
    }

    if (['getArtifact', 'getFunction', 'getNeighbors'].includes(action.type)) {
      this.recordPreAdmission(action, action.artifactId || '');
      return super.resolveNextAction(action, candidates);
    }

    // backtrack/stop before admission mean "this evidence path is exhausted",
    // not "the entire repository has no business use case". Continue from an
    // unvisited repository frontier item when one exists.
    if (action.type === 'backtrack' || action.type === 'stop') {
      const fallback = this.state.frontier.find((candidate) => candidate?.id && !this.state.visited.includes(candidate.id));
      if (fallback) {
        this.removeFrontier(fallback.id);
        this.recordTraversalEdge(this._currentObservationId || '', fallback.id, fallback.relation || 'pre_admission_backtrack', 'traversed');
        this.recordPreAdmission(action, fallback.id);
        return this.topology.getArtifact(fallback.id);
      }
      this.recordPreAdmission(action, '');
      return null;
    }

    return super.resolveNextAction(action, candidates);
  }

  async resolveNextAction(action, candidates) {
    if (!this.hasAdmittedArc()) return this.resolvePreAdmission(action, candidates);
    return super.resolveNextAction(action, candidates);
  }
}
