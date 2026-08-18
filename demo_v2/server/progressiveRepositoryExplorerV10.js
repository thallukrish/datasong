import { ProgressiveRepositoryExplorerV9 } from './progressiveRepositoryExplorerV9.js';

function arr(value) { return Array.isArray(value) ? value : []; }

const MIN_SEMANTIC_FIT = 0.25;

export class ProgressiveRepositoryExplorerV10 extends ProgressiveRepositoryExplorerV9 {
  emptyState() {
    const state = super.emptyState();
    state.semanticEscapes = [];
    return state;
  }

  rankedNeighborhood(candidateScores, candidates) {
    const byId = new Map(arr(candidates).map((candidate) => [candidate.id, candidate]));
    return arr(candidateScores)
      .filter((item) => byId.has(item?.artifactId) && !this.state.visited.includes(item.artifactId))
      .map((item) => {
        const candidate = byId.get(item.artifactId);
        return { item, candidate, score: this.semanticScore(item, candidate) };
      })
      .sort((a, b) => b.score - a.score);
  }

  pruneFrameFromScores(candidateScores, candidates, selected = null) {
    const ranked = this.rankedNeighborhood(candidateScores, candidates);
    this.rememberScoredAlternatives(ranked, selected);
    return ranked;
  }

  async semanticPendingBacktrack(currentId) {
    // Once semantic scoring has happened, backtracking must only consider
    // alternatives that survived semantic admissibility. Mechanical-but-unvisited
    // edges are not valid DFS pending work.
    for (let i = this.state.executionStack.length - 1; i >= 0; i -= 1) {
      const frame = this.state.executionStack[i];
      if (!Object.prototype.hasOwnProperty.call(frame, 'semanticPendingIds')) continue;
      const remaining = this.remainingForFrame(frame);
      if (!remaining.length) continue;
      const candidate = remaining[0];
      this.removeFrontier(candidate.id);
      this.recordTraversalEdge(currentId, candidate.id, candidate.relation || 'semantic_backtrack', 'traversed');
      this.state.branchSignalTrail = Number.isFinite(candidate._semanticFit)
        ? [{ step: this.state.step, artifactId: candidate.id, score: candidate._semanticFit }]
        : [];
      return this.topology.getArtifact(candidate.id);
    }
    return null;
  }

  activeBusinessStory(candidateScores = []) {
    const scoredThreadIds = arr(candidateScores)
      .map((item) => String(item?.threadId || ''))
      .filter((id) => id && id !== 'NEW' && id !== 'UNATTACHED');
    for (const id of scoredThreadIds) {
      const story = this.state.stories.find((item) => item.id === id);
      if (story) return story;
    }
    return this.state.stories.at(-1) || null;
  }

  semanticEscapeQuery(story) {
    if (!story) return '';
    const recent = arr(story.steps)
      .slice(-4)
      .map((step) => String(step?.meaning || '').trim())
      .filter(Boolean)
      .join(' ');
    return `${story.title || 'business use case'} ${recent} end-to-end business use case implementation`.trim();
  }

  async semanticEscape(currentId, candidateScores = []) {
    const story = this.activeBusinessStory(candidateScores);
    const query = this.semanticEscapeQuery(story);
    if (!query) return null;

    // Avoid repeatedly issuing the same goal-directed escape from the same point.
    const key = `${currentId}::${query}`;
    if (this.state.semanticEscapes.some((entry) => entry.key === key)) return null;

    const hits = arr(await this.topology.searchSemantic(query))
      .filter((hit) => hit?.id && !this.state.visited.includes(hit.id));

    this.state.semanticEscapes.push({
      key,
      step: this.state.step,
      from: currentId,
      storyId: story?.id || '',
      storyTitle: story?.title || '',
      query,
      hitCount: hits.length
    });
    this.state.semanticEscapes = this.state.semanticEscapes.slice(-100);

    if (!hits.length) return null;

    return {
      id: `semantic-search:${encodeURIComponent(query)}:${this.state.step}`,
      path: query,
      kind: 'semantic_neighborhood',
      summary: `Goal-directed semantic escape for ${story?.title || 'active business use case'}`,
      canonical: {
        kind: 'semantic_search_results',
        query,
        businessThread: story ? { id: story.id, title: story.title } : null,
        nodes: hits.map((hit) => this.candidateDescriptor(hit)),
        note: 'Local topology was semantically exhausted; these results are anchored to the active business-use-case thread.'
      },
      neighbors: hits,
      sourceCoverage: null
    };
  }

  async resolveNextAction(action, candidates) {
    const request = action || { type: 'stop' };
    const scores = arr(request.candidateScores);
    const currentId = this._currentObservationId || '';
    const anchorId = this._activeNeighborhoodAnchorId || currentId;

    if (request.type === 'backtrack' && scores.length) {
      // Critical fix: scoring is authoritative even when the model chooses
      // backtrack instead of advance. Prune the current DFS frame before looking
      // for somewhere else to go, otherwise weak cleanup/helper edges remain as
      // mechanically-unvisited candidates and pull exploration off the business flow.
      const ranked = this.pruneFrameFromScores(scores, candidates, null);
      const frame = this.frameForSemanticAnchor();
      if (frame) {
        frame.semanticRejectedIds = ranked
          .filter((entry) => entry.score < MIN_SEMANTIC_FIT)
          .map((entry) => entry.candidate.id);
      }
      this.state.branchSignalTrail = [];

      const pending = await this.semanticPendingBacktrack(anchorId);
      if (pending) return pending;

      // No semantically admissible DFS alternative remains. Escape the local
      // topology using the active BUSINESS thread as the search objective rather
      // than falling back to unrelated global/mechanical frontier nodes.
      return this.semanticEscape(anchorId, scores);
    }

    if (request.type === 'searchSemantic' && scores.length) {
      // A model may explicitly request semantic search after determining that the
      // supplied local neighborhood is weak. Prune first, then honor the search;
      // do not let the older stack guard force a low-value local edge instead.
      this.pruneFrameFromScores(scores, candidates, null);
      const hits = arr(await this.topology.searchSemantic(request.query))
        .filter((hit) => hit?.id && !this.state.visited.includes(hit.id));
      if (!hits.length) return this.semanticPendingBacktrack(anchorId);
      return {
        id: `semantic-search:${encodeURIComponent(request.query)}:${this.state.step}`,
        path: request.query,
        kind: 'semantic_neighborhood',
        summary: `Canonical semantic search results for ${request.query}`,
        canonical: {
          kind: 'semantic_search_results',
          query: request.query,
          nodes: hits.map((hit) => this.candidateDescriptor(hit)),
          note: 'Explicit semantic search after pruning the scored local DFS frame.'
        },
        neighbors: hits,
        sourceCoverage: null
      };
    }

    return super.resolveNextAction(request, candidates);
  }
}
