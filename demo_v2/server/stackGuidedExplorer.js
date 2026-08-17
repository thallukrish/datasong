import { SemanticFunctionExplorer } from './semanticFunctionExplorer.js';

function safeArray(value) { return Array.isArray(value) ? value : []; }
function short(value, max = 500) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }

export class StackGuidedExplorer extends SemanticFunctionExplorer {
  emptyState() {
    const state = super.emptyState();
    state.executionStack = [];
    state.invalidNextActions = [];
    return state;
  }

  frameFor(id) {
    return this.state.executionStack.find((frame) => frame.id === id) || null;
  }

  rememberFrame(observation) {
    if (!observation?.id) return;
    const ids = safeArray(observation.neighbors).map((n) => n?.id).filter(Boolean);
    let frame = this.frameFor(observation.id);
    if (!frame) {
      frame = { id: observation.id, path: observation.path || '', candidateIds: [], completed: false };
      this.state.executionStack.push(frame);
    }
    for (const id of ids) if (!frame.candidateIds.includes(id)) frame.candidateIds.push(id);
    frame.completed = false;

    // Keep the currently observed node at the top. If it was reached again only
    // as a cached/back-edge, CycleSafeExplorer will block the traversal before
    // another LLM call, so this does not reintroduce graph cycles.
    const index = this.state.executionStack.indexOf(frame);
    if (index >= 0 && index !== this.state.executionStack.length - 1) {
      this.state.executionStack.splice(index, 1);
      this.state.executionStack.push(frame);
    }
    this.state.executionStack = this.state.executionStack.slice(-120);
  }

  candidateFromFrontier(id) {
    return this.state.frontier.find((item) => item?.id === id) || null;
  }

  remainingForFrame(frame) {
    if (!frame) return [];
    return frame.candidateIds
      .filter((id) => !this.state.visited.includes(id))
      .map((id) => this.candidateFromFrontier(id))
      .filter(Boolean)
      .map((candidate) => ({ ...candidate, _locality: 'resume' }))
      .sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a));
  }

  candidatesFor(observation) {
    this._currentObservationId = observation?.id || '';
    this.rememberFrame(observation);

    // Let CycleSafeExplorer perform visited/back-edge bookkeeping first, but do
    // not accept its global candidates while a local execution path exists.
    const base = super.candidatesFor(observation);
    const directIds = new Set(safeArray(observation?.neighbors).map((n) => n?.id).filter(Boolean));
    const direct = base
      .filter((candidate) => directIds.has(candidate.id) && !this.state.visited.includes(candidate.id))
      .map((candidate) => ({ ...candidate, _locality: 'local' }))
      .sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a));

    if (direct.length) return direct.slice(0, 10);

    // Current function is exhausted. Walk back up the execution stack and offer
    // only the nearest caller/ancestor's unvisited outgoing edges. This is the
    // important return-to-caller behavior after leaves and external boundaries.
    const current = this.frameFor(observation?.id);
    if (current) current.completed = true;
    for (let i = this.state.executionStack.length - 2; i >= 0; i -= 1) {
      const frame = this.state.executionStack[i];
      const remaining = this.remainingForFrame(frame);
      if (remaining.length) return remaining.slice(0, 10);
      frame.completed = true;
    }

    // Only once the active execution stack is genuinely exhausted may the
    // explorer consider the broader repository frontier.
    return base
      .filter((candidate) => !directIds.has(candidate.id))
      .map((candidate) => ({ ...candidate, _locality: 'global' }))
      .slice(0, 4);
  }

  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);
    const stack = this.state.executionStack.slice(-8).map((frame) => ({
      id: frame.id,
      path: frame.path,
      completed: frame.completed,
      remaining: frame.candidateIds.filter((id) => !this.state.visited.includes(id)).length
    }));
    return `EXECUTION-STACK DISCIPLINE\nYou are inspecting exactly ONE semantic function body/value/contract in this call. Other functions appear only as lightweight candidate descriptors; their bodies are not present.\nStay on the current vertical slice. Prefer direct local edges. If the current function is exhausted, candidates marked resume come from the nearest caller/ancestor with an unvisited edge. Global candidates appear only after the local execution stack is exhausted.\nFor next.type=artifact, artifactId MUST exactly equal one of the supplied candidate IDs. Never shorten, rewrite, reconstruct or omit an ID prefix.\n\nEXECUTION STACK\n${JSON.stringify(stack)}\n\n${base}`;
  }

  async getSemanticUpdate(args) {
    let result = await super.getSemanticUpdate(args);
    if (this.validNext(result.parsed?.next, args.candidates)) return result;

    const invalid = result.parsed?.next || {};
    this.state.invalidNextActions.push({
      step: this.state.step,
      observedId: args.observation?.id || '',
      type: invalid.type || '',
      artifactId: short(invalid.artifactId, 500)
    });
    this.state.invalidNextActions = this.state.invalidNextActions.slice(-80);

    // Do not apply a semantic delta whose navigation points to an invented or
    // malformed candidate ID. Retry the same single-function observation with
    // the exact allowed IDs visible to the model.
    const allowed = safeArray(args.candidates).map((candidate) => candidate.id);
    const retryPrompt = `${args.dynamicPrompt}\n\nNAVIGATION RETRY: Your previous next action was invalid. If next.type is artifact, copy artifactId EXACTLY from this JSON array: ${JSON.stringify(allowed)}. If none is appropriate, use stop. Do not use a repository search while local/resume candidates are supplied.`;
    result = await super.getSemanticUpdate({ ...args, dynamicPrompt: retryPrompt });
    if (!this.validNext(result.parsed?.next, args.candidates)) {
      throw new Error(`Model returned an invalid next artifact ID twice at exploration step ${this.state.step}; refusing silent fallback.`);
    }
    return result;
  }

  validNext(next, candidates) {
    if (!next || !next.type) return true;
    if (next.type !== 'artifact') return true;
    const id = short(next.artifactId, 500);
    return !!id && safeArray(candidates).some((candidate) => candidate.id === id);
  }

  async resolveNextAction(action, candidates) {
    if (action?.type === 'artifact') {
      const id = short(action.artifactId, 500);
      const candidate = safeArray(candidates).find((item) => item?.id === id && !this.state.visited.includes(item.id));
      if (!candidate) throw new Error(`Invalid or already visited artifactId at step ${this.state.step}: ${id || '<empty>'}`);
      this.removeFrontier(candidate.id);
      this.recordTraversalEdge(this._currentObservationId || '', candidate.id, candidate.relation || 'reference', 'traversed');
      return this.topology.observe(candidate.id);
    }

    // A search is not permitted while the deterministic execution stack still
    // exposes local/resume candidates. Searching here caused previous semantic
    // wandering into unrelated repository entry points.
    const stackCandidates = safeArray(candidates).filter((candidate) => candidate._locality === 'local' || candidate._locality === 'resume');
    if (action?.type === 'search' && stackCandidates.length) {
      const candidate = [...stackCandidates].sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a))[0];
      this.removeFrontier(candidate.id);
      this.recordTraversalEdge(this._currentObservationId || '', candidate.id, candidate.relation || 'stack_resume', 'traversed');
      return this.topology.observe(candidate.id);
    }

    if (action?.type === 'stop' && stackCandidates.length) {
      const candidate = [...stackCandidates].sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a))[0];
      this.removeFrontier(candidate.id);
      this.recordTraversalEdge(this._currentObservationId || '', candidate.id, candidate.relation || 'stack_resume', 'traversed');
      return this.topology.observe(candidate.id);
    }

    return super.resolveNextAction(action, candidates);
  }
}
