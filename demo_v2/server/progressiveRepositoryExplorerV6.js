import { ProgressiveRepositoryExplorerV5 } from './progressiveRepositoryExplorerV5.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function score01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const MIN_SEMANTIC_FIT = 0.25;
const FLATTENING_WINDOW = 3;
const MIN_TOTAL_DECLINE = 0.10;
const NEXT_IN_SOURCE_FACTOR = 0.35;

export class ProgressiveRepositoryExplorerV6 extends ProgressiveRepositoryExplorerV5 {
  emptyState() {
    const state = super.emptyState();
    state.branchSignalTrail = [];
    state.flattenedBranches = [];
    return state;
  }

  buildPrompt(observation, candidates) {
    if (observation?.kind === 'semantic_neighborhood') {
      this._activeNeighborhoodAnchorId = observation?.canonical?.anchor?.id || '';
    }
    return super.buildPrompt(observation, candidates);
  }

  semanticScore(item, candidate) {
    const base = 0.45 * score01(item?.continuity)
      + 0.45 * score01(item?.coherence)
      + 0.10 * score01(item?.expectedGain);
    return base * (candidate?.relation === 'next_in_source' ? NEXT_IN_SOURCE_FACTOR : 1);
  }

  frameForSemanticAnchor() {
    return this.frameFor(this._activeNeighborhoodAnchorId || '') || null;
  }

  rememberScoredAlternatives(ranked, selected) {
    const frame = this.frameForSemanticAnchor();
    if (!frame) return;

    const pending = ranked
      .filter((entry) => entry.score >= MIN_SEMANTIC_FIT && entry.candidate.id !== selected?.id)
      .filter((entry) => !this.state.visited.includes(entry.candidate.id));

    // Once a semantic neighborhood has been scored, the DFS frame should keep
    // only unresolved, admissible alternatives. Weak paths are not retained
    // merely because they were mechanically reachable.
    frame.semanticPendingIds = pending.map((entry) => entry.candidate.id);
    frame.semanticPendingScores = Object.fromEntries(pending.map((entry) => [entry.candidate.id, entry.score]));
    frame.candidateIds = [...frame.semanticPendingIds];
  }

  remainingForFrame(frame) {
    if (!frame || !Object.prototype.hasOwnProperty.call(frame, 'semanticPendingIds')) {
      return super.remainingForFrame(frame);
    }

    return arr(frame.semanticPendingIds)
      .filter((id) => !this.state.visited.includes(id))
      .map((id) => this.candidateFromFrontier(id))
      .filter(Boolean)
      .map((candidate) => ({
        ...candidate,
        _locality: 'resume',
        _semanticFit: Number(frame.semanticPendingScores?.[candidate.id]) || 0
      }))
      .sort((a, b) => b._semanticFit - a._semanticFit);
  }

  chooseScoredCandidate(candidateScores, candidates) {
    const byId = new Map(arr(candidates).map((candidate) => [candidate.id, candidate]));
    const ranked = arr(candidateScores)
      .filter((item) => byId.has(item.artifactId) && !this.state.visited.includes(item.artifactId))
      .map((item) => {
        const candidate = byId.get(item.artifactId);
        return { item, candidate, score: this.semanticScore(item, candidate) };
      })
      .sort((a, b) => b.score - a.score);

    const selectedEntry = ranked.find((entry) => entry.score >= MIN_SEMANTIC_FIT) || null;
    this._lastChosenSemanticFit = selectedEntry?.score ?? null;
    this.rememberScoredAlternatives(ranked, selectedEntry?.candidate || null);
    return selectedEntry?.candidate || null;
  }

  isFlatteningAfter(score) {
    if (!Number.isFinite(score) || score < MIN_SEMANTIC_FIT) return false;
    const trail = [...arr(this.state.branchSignalTrail), score].slice(-FLATTENING_WINDOW);
    if (trail.length < FLATTENING_WINDOW) return false;
    const strictlyDeclining = trail.every((value, index) => index === 0 || trail[index - 1] > value);
    const totalDecline = trail[0] - trail.at(-1);
    return strictlyDeclining && totalDecline >= MIN_TOTAL_DECLINE;
  }

  recordChosenSignal(candidate, score) {
    this.state.branchSignalTrail.push({
      step: this.state.step,
      artifactId: candidate?.id || '',
      score
    });
    this.state.branchSignalTrail = this.state.branchSignalTrail.slice(-FLATTENING_WINDOW);
  }

  signalValues() {
    return arr(this.state.branchSignalTrail).map((entry) => Number(entry.score)).filter(Number.isFinite);
  }

  async backtrackFrom(currentId) {
    const index = this.state.executionStack.findIndex((frame) => frame.id === currentId);
    if (index >= 0) this.state.executionStack.splice(index, 1);

    for (let i = this.state.executionStack.length - 1; i >= 0; i -= 1) {
      const remaining = this.remainingForFrame(this.state.executionStack[i]);
      if (!remaining.length) continue;
      const candidate = remaining[0];
      this.removeFrontier(candidate.id);
      this.recordTraversalEdge(currentId, candidate.id, candidate.relation || 'semantic_backtrack', 'traversed');
      this.state.branchSignalTrail = Number.isFinite(candidate._semanticFit)
        ? [{ step: this.state.step, artifactId: candidate.id, score: candidate._semanticFit }]
        : [];
      return this.topology.getArtifact(candidate.id);
    }

    this.state.branchSignalTrail = [];
    const global = this.state.frontier
      .filter((item) => item?.id && !this.state.visited.includes(item.id))
      .sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a))[0];
    if (!global) return null;
    this.removeFrontier(global.id);
    return this.topology.getArtifact(global.id);
  }

  async resolveNextAction(action, candidates) {
    const request = action || { type: 'stop' };

    if (request.type !== 'advance') {
      if (request.type === 'backtrack' || request.type === 'stop') this.state.branchSignalTrail = [];
      return super.resolveNextAction(request, candidates);
    }

    this.state.evidenceRequests.push({ step: this.state.step, ...request });
    this.state.evidenceRequests = this.state.evidenceRequests.slice(-200);
    const currentId = this._currentObservationId || '';
    const anchorId = this._activeNeighborhoodAnchorId || currentId;
    const candidate = this.chooseScoredCandidate(request.candidateScores, candidates);

    if (!candidate) {
      this.state.branchSignalTrail = [];
      return this.backtrackFrom(anchorId);
    }

    const score = Number(this._lastChosenSemanticFit);
    const previousSignals = this.signalValues();
    const flattening = this.isFlatteningAfter(score);

    if (flattening) {
      const trail = [...previousSignals, score].slice(-FLATTENING_WINDOW);
      this.state.flattenedBranches.push({
        step: this.state.step,
        anchorId,
        candidateId: candidate.id,
        scores: trail,
        reason: `semantic fit declined across ${FLATTENING_WINDOW} rolls by at least ${MIN_TOTAL_DECLINE}`
      });
      this.state.flattenedBranches = this.state.flattenedBranches.slice(-100);
      this.state.branchSignalTrail = [];
      return this.backtrackFrom(anchorId);
    }

    this.recordChosenSignal(candidate, score);
    this.removeFrontier(candidate.id);
    this.recordTraversalEdge(currentId, candidate.id, candidate.relation || 'semantic_advance', 'traversed');
    return this.topology.getArtifact(candidate.id);
  }
}
