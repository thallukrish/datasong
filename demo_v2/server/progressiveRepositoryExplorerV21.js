import { ProgressiveRepositoryExplorerV20 } from './progressiveRepositoryExplorerV20.js';
import { Pass1ArcScheduler } from './pass1ArcScheduler.js';
import { Pass2ArcExplorerState } from './pass2ArcExplorerState.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 400) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const PASS12_SYSTEM = `You are DataSong's semantic navigator in a two-layer exploration system.
Pass 1 is a global scheduler across business-use-case arcs. Score current evidence against every known arc using continuity, coherence and expected gain, and surface distinct new business arcs when evidence supports them.
Pass 2 is a local explorer inside the arc selected by Pass 1. Candidate artifacts are signatures only; never invent their bodies. DataSong owns per-arc DFS state, branch persistence, backtracking and arc scheduling.
Return strict compact JSON matching the supplied contract.`;

export class ProgressiveRepositoryExplorerV21 extends ProgressiveRepositoryExplorerV20 {
  emptyState() {
    const state = super.emptyState();
    state.pass1Scheduler = { activeArcId: '', nextArcNumber: 1, decisions: [], fitHistory: [] };
    state.pass2DfsByArc = {};
    state.arcSchedulerVersion = 'pass1-scheduler-pass2-per-arc-dfs-v1';
    return state;
  }

  pass1() {
    if (!this._pass1Scheduler) this._pass1Scheduler = new Pass1ArcScheduler(this);
    this._pass1Scheduler.ensureState();
    return this._pass1Scheduler;
  }

  pass2() {
    if (!this._pass2State) this._pass2State = new Pass2ArcExplorerState(this);
    this._pass2State.ensureState();
    return this._pass2State;
  }

  compactCurrent(observation) {
    const canonical = observation?.kind === 'xml_file'
      ? this.compactXmlCanonical(observation?.canonical || {})
      : (observation?.canonical || {});
    return canonical;
  }

  compactCandidates(candidates) {
    return arr(candidates).map((candidate) => this.compactCandidate(candidate)).filter(Boolean);
  }

  semanticMode(observation) {
    return ['semantic_function', 'xml_file', 'config_file', 'text_file', 'semantic_neighborhood'].includes(observation?.kind);
  }

  buildPrompt(observation, candidates) {
    if (!this.semanticMode(observation)) return super.buildPrompt(observation, candidates);

    const board = this.pass1().arcBoard();
    const activeArcId = this.pass1().activeArcId();
    const current = this.compactCurrent(observation);
    const available = this.compactCandidates(candidates);
    const isNeighborhood = observation?.kind === 'semantic_neighborhood';

    const contract = {
      meaning: isNeighborhood ? 'brief meaning of this candidate set for scheduling' : 'brief business meaning of current evidence',
      arcFits: [{
        arcId: 'each supplied arc id',
        continuity: 0,
        coherence: 0,
        expectedGain: 0,
        reason: 'brief'
      }],
      bestArc: 'existing arc id | NEW | UNATTACHED',
      newArcs: [{
        title: 'distinct business use case supported by evidence',
        concept: 'brief concept',
        confidence: 0,
        reason: 'brief'
      }],
      arcUpdate: {
        arcId: 'existing arc id or empty when NEW/UNATTACHED',
        evidenceRole: 'major|supporting|trivial',
        trigger: 'actor/intent if learned',
        majorStages: ['new broad stage only'],
        outcome: 'business/persistence/external outcome if learned',
        entities: ['major entity'],
        relationships: ['major relationship'],
        status: 'forming|broadly_complete|unresolved'
      },
      candidateScores: [{
        artifactId: 'exact supplied candidate id',
        arcId: 'arc this candidate would continue',
        continuity: 0,
        coherence: 0,
        expectedGain: 0,
        reason: 'brief'
      }],
      evidenceRequest: {
        type: 'advance|getArtifact|getFunction|getNeighbors|searchSemantic|backtrack|stop',
        artifactId: 'exact supplied/known id when used',
        depth: 2,
        query: 'keywords only for searchSemantic',
        alternateQueries: ['optional'],
        reason: 'brief'
      }
    };

    return `MODE pass1-scheduler -> pass2-local-explorer\nACTIVE_ARC ${activeArcId || 'NONE'}\nARC_BOARD ${JSON.stringify(board)}\nCURRENT ${JSON.stringify(current)}\nCANDIDATES_SIGNATURE_ONLY ${JSON.stringify(available)}\nRETURN ${JSON.stringify(contract)}\nRules:\n- Score current evidence against EVERY ARC_BOARD arc. Arc IDs are stable; copy them exactly.\n- Pass 1 may create several new arcs from one artifact when genuinely distinct business use cases are visible.\n- Do not create a new arc from a candidate signature alone unless the CURRENT evidence itself supports that distinct use case.\n- candidateScores are local Pass-2 possibilities; score only supplied candidate IDs and name which arc each would continue.\n- Pass 1, not the model, decides which arc gets the next exploration turn.\n- Pass 2 preserves separate DFS state for every arc; switching arcs does not discard another arc's pending branches.\n- Keep broad Pass-1 stages monotonic; do not reinterpret accumulated progress downward.\n- Keep text brief.`;
  }

  async callModel(dynamicPrompt) {
    if (String(dynamicPrompt || '').startsWith('MODE pass1-scheduler')) {
      return this.lightweightModelCall(PASS12_SYSTEM, dynamicPrompt, 'PASS 1 SCHEDULER / PASS 2 EXPLORER');
    }
    return super.callModel(dynamicPrompt);
  }

  normalizePass12(parsed, candidates) {
    const out = parsed && typeof parsed === 'object' ? parsed : {};
    out.meaning = text(out.meaning, 500);
    out.arcFits = arr(out.arcFits).map((fit) => ({
      arcId: String(fit?.arcId || '').trim(),
      continuity: clamp01(fit?.continuity),
      coherence: clamp01(fit?.coherence),
      expectedGain: clamp01(fit?.expectedGain),
      reason: text(fit?.reason, 220)
    }));
    // Missing arc scores are normalized to explicit zero rather than causing a
    // costly retry. Pass 1 still receives a complete score vector.
    const seen = new Set(out.arcFits.map((fit) => fit.arcId));
    for (const arc of this.pass1().arcs()) {
      if (!seen.has(arc.id)) out.arcFits.push({ arcId: arc.id, continuity: 0, coherence: 0, expectedGain: 0, reason: '' });
    }

    out.newArcs = arr(out.newArcs || (out.newArc ? [out.newArc] : [])).map((seed) => ({
      title: text(seed?.title, 180),
      concept: text(seed?.concept, 320),
      confidence: clamp01(seed?.confidence),
      reason: text(seed?.reason, 260),
      trigger: text(seed?.trigger, 260),
      outcome: text(seed?.outcome, 260),
      majorStages: arr(seed?.majorStages),
      entities: arr(seed?.entities),
      relationships: arr(seed?.relationships)
    })).filter((seed) => seed.title);

    const update = out.arcUpdate && typeof out.arcUpdate === 'object' ? out.arcUpdate : {};
    out.arcUpdate = {
      arcId: String(update.arcId || '').trim(),
      evidenceRole: ['major', 'supporting', 'trivial'].includes(update.evidenceRole) ? update.evidenceRole : 'supporting',
      title: text(update.title, 180),
      trigger: text(update.trigger, 300),
      majorStages: arr(update.majorStages).map((v) => text(v, 240)).filter(Boolean),
      outcome: text(update.outcome, 350),
      entities: arr(update.entities).map((v) => text(v, 180)).filter(Boolean),
      relationships: arr(update.relationships).map((v) => text(v, 240)).filter(Boolean),
      status: ['forming', 'broadly_complete', 'unresolved'].includes(update.status) ? update.status : 'forming'
    };

    const knownCandidateIds = new Set(arr(candidates).map((candidate) => candidate.id));
    out.candidateScores = arr(out.candidateScores)
      .filter((score) => knownCandidateIds.has(score?.artifactId))
      .map((score) => ({
        artifactId: score.artifactId,
        arcId: String(score?.arcId || '').trim(),
        continuity: clamp01(score?.continuity),
        coherence: clamp01(score?.coherence),
        expectedGain: clamp01(score?.expectedGain),
        reason: text(score?.reason, 220)
      }));

    const allowed = new Set(['advance', 'getArtifact', 'getFunction', 'getNeighbors', 'searchSemantic', 'backtrack', 'stop']);
    const request = out.evidenceRequest && typeof out.evidenceRequest === 'object' ? out.evidenceRequest : { type: 'advance' };
    if (!allowed.has(request.type)) request.type = out.candidateScores.length ? 'advance' : 'backtrack';
    out.evidenceRequest = request;
    out.next = request;
    out._pass12 = true;
    return out;
  }

  async getSemanticUpdate(args) {
    if (!this.semanticMode(args.observation)) return super.getSemanticUpdate(args);

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${args.dynamicPrompt}\nRETRY: return complete valid JSON only.` : args.dynamicPrompt;
      const result = await this.callAndRecordAttempt({
        dynamicPrompt: prompt,
        observation: args.observation,
        candidates: args.candidates,
        before: args.before,
        maxTokens: undefined,
        retry
      });
      try {
        const raw = JSON.parse(result.raw);
        const parsed = this.normalizePass12(raw, args.candidates);
        if (!parsed.meaning && args.observation?.kind !== 'semantic_neighborhood') throw new Error('meaning is required');
        this._lastPass2Candidates = arr(args.candidates);
        return { ...result, parsed };
      } catch (error) {
        lastError = error;
        await this.appendRunLog({
          type: 'llm_invalid_pass12', call: result.callNumber, explorationStep: this.state.step,
          retry, timestamp: new Date().toISOString(), error: error.message, rawResponse: result.raw,
          usage: result.usage, cumulativeUsage: { ...this.state.tokenUsage }
        });
        this.printCallSummary(result.usage, result.callNumber, `rejected/${error.message}`);
      }
    }
    throw new Error(`No valid Pass-1/Pass-2 semantic response after retry at step ${this.state.step}: ${lastError?.message || 'unknown error'}`);
  }

  scoreCandidate(item) { return this.pass1().scoreFit(item); }

  storeCandidateScoresForAllArcs(parsed) {
    const map = this.pass2().ensureState();
    const currentSnapshot = this.pass2().snapshotCurrent();
    for (const arc of this.pass1().arcs()) {
      if (!map[arc.id]) map[arc.id] = JSON.parse(JSON.stringify(currentSnapshot));
      const saved = map[arc.id];
      const scores = arr(parsed.candidateScores)
        .filter((item) => item.arcId === arc.id)
        .map((item) => ({ ...item, score: this.scoreCandidate(item) }))
        .filter((item) => item.score >= 0.25)
        .sort((a, b) => b.score - a.score);
      if (!scores.length) continue;
      const anchorId = saved.activeNeighborhoodAnchorId || saved.currentObservationId || this._currentObservationId || '';
      let frame = arr(saved.executionStack).find((item) => item.id === anchorId) || arr(saved.executionStack).at(-1);
      if (!frame) continue;
      frame.semanticPendingIds = scores.map((item) => item.artifactId);
      frame.semanticPendingScores = Object.fromEntries(scores.map((item) => [item.artifactId, item.score]));
      frame.candidateIds = [...frame.semanticPendingIds];
    }
  }

  applyDelta(parsed, observation) {
    if (!parsed?._pass12) return super.applyDelta(parsed, observation);

    const previousArcId = this.pass1().activeArcId();
    this._schedulerObservation = observation;
    this.storeCandidateScoresForAllArcs(parsed);
    const decision = this.pass1().consume(parsed, observation);
    const nextArcId = decision.nextArc?.id || previousArcId || '';

    // Persist the DFS context just used, then restore the selected arc's own
    // Pass-2 state. The model response always flows through Pass 1 before local
    // navigation is resumed.
    if (previousArcId) this.pass2().capture(previousArcId);
    for (const arc of this.pass1().arcs()) this.pass2().seed(arc.id);
    if (nextArcId && nextArcId !== previousArcId) {
      this.pass2().switch(previousArcId, nextArcId);
      this._scheduledArcSwitch = { fromArcId: previousArcId, toArcId: nextArcId };
    } else if (nextArcId) {
      this.pass2().capture(nextArcId);
      this._scheduledArcSwitch = null;
    }

    if (!decision.evidenceArc && parsed.meaning) {
      this.state.unattachedFragments.push({ artifactId: observation?.id || '', meaning: parsed.meaning });
      this.state.unattachedFragments = this.state.unattachedFragments.slice(-40);
    }
    this.state.lastMessage = decision.nextArc
      ? `Pass 1 scheduled ${decision.nextArc.title}.`
      : (parsed.meaning || 'Updated Pass-1 arc board.');
    if (typeof this.topology.repositoryCoverageSnapshot === 'function') this.state.sourceCoverage = this.topology.repositoryCoverageSnapshot();
  }

  async semanticSearchForArc(arc) {
    if (!arc) return null;
    const query = `${arc.title} ${arr(arc.majorStages).slice(-4).join(' ')} ${arc.outcome || ''}`.trim();
    if (!query) return null;
    const hits = arr(await this.topology.searchSemantic(query)).filter((hit) => hit?.id && !this.state.visited.includes(hit.id));
    if (!hits.length) return null;
    return {
      id: `pass2-arc-search:${arc.id}:${this.state.step}`,
      path: query,
      kind: 'semantic_neighborhood',
      summary: `Pass 2 search for ${arc.title}`,
      canonical: { kind: 'semantic_search_results', query, arcId: arc.id },
      neighbors: hits,
      sourceCoverage: null
    };
  }

  async resumePass2Arc(arcId) {
    const arc = this.pass1().arcByReference(arcId);
    if (!arc) return null;
    this.pass2().restore(arc.id);
    for (let i = this.state.executionStack.length - 1; i >= 0; i -= 1) {
      const frame = this.state.executionStack[i];
      const remaining = this.remainingForFrame(frame);
      if (!remaining.length) continue;
      const candidate = remaining[0];
      this.removeFrontier(candidate.id);
      this.recordTraversalEdge(this._currentObservationId || '', candidate.id, candidate.relation || 'pass2_resume', 'traversed');
      return this.topology.getArtifact(candidate.id);
    }
    return this.semanticSearchForArc(arc);
  }

  candidateForActiveArc(parsed, candidates) {
    const activeArcId = this.pass1().activeArcId();
    const byId = new Map(arr(candidates).map((candidate) => [candidate.id, candidate]));
    return arr(parsed?.candidateScores)
      .filter((item) => item.arcId === activeArcId && byId.has(item.artifactId) && !this.state.visited.includes(item.artifactId))
      .map((item) => ({ item, candidate: byId.get(item.artifactId), score: this.scoreCandidate(item) }))
      .filter((entry) => entry.score >= 0.25)
      .sort((a, b) => b.score - a.score)[0]?.candidate || null;
  }

  async resolveNextAction(action, candidates) {
    if (this._scheduledArcSwitch) {
      const target = this._scheduledArcSwitch.toArcId;
      this._scheduledArcSwitch = null;
      return this.resumePass2Arc(target);
    }

    const request = action || { type: 'advance' };
    this.normalizeSemanticSourceContainerRequest(request);
    this.normalizeTypedArtifactRequest(request, null, candidates);

    if (request.type === 'advance') {
      const candidate = this.candidateForActiveArc({ candidateScores: request.candidateScores || [] }, candidates)
        || this.candidateForActiveArc({ candidateScores: this._lastParsedCandidateScores || [] }, candidates);
      if (candidate) {
        this.removeFrontier(candidate.id);
        this.recordTraversalEdge(this._currentObservationId || '', candidate.id, candidate.relation || 'pass2_advance', 'traversed');
        return this.topology.getArtifact(candidate.id);
      }
      return this.resumePass2Arc(this.pass1().activeArcId());
    }

    if (request.type === 'backtrack' || request.type === 'stop') {
      return this.resumePass2Arc(this.pass1().activeArcId());
    }

    if (request.type === 'searchSemantic') {
      const hits = arr(await this.topology.searchSemantic(request.query)).filter((hit) => hit?.id && !this.state.visited.includes(hit.id));
      if (hits.length) {
        return {
          id: `pass2-search:${this.pass1().activeArcId()}:${this.state.step}`,
          path: request.query,
          kind: 'semantic_neighborhood',
          summary: `Pass 2 explicit search for ${request.query}`,
          canonical: { kind: 'semantic_search_results', query: request.query, arcId: this.pass1().activeArcId() },
          neighbors: hits,
          sourceCoverage: null
        };
      }
      return this.resumePass2Arc(this.pass1().activeArcId());
    }

    // Typed direct artifact/function/neighborhood operations remain deterministic
    // repository mechanics and are safe to delegate to the existing implementation.
    return super.resolveNextAction(request, candidates);
  }

  async getSemanticUpdate(args) {
    const result = await (this.semanticMode(args.observation)
      ? this._getPass12SemanticUpdate(args)
      : super.getSemanticUpdate(args));
    return result;
  }

  async _getPass12SemanticUpdate(args) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${args.dynamicPrompt}\nRETRY: return complete valid JSON only.` : args.dynamicPrompt;
      const result = await this.callAndRecordAttempt({ dynamicPrompt: prompt, observation: args.observation, candidates: args.candidates, before: args.before, maxTokens: undefined, retry });
      try {
        const raw = JSON.parse(result.raw);
        const parsed = this.normalizePass12(raw, args.candidates);
        if (!parsed.meaning && args.observation?.kind !== 'semantic_neighborhood') throw new Error('meaning is required');
        this._lastPass2Candidates = arr(args.candidates);
        this._lastParsedCandidateScores = arr(parsed.candidateScores);
        parsed.next = { ...parsed.evidenceRequest, candidateScores: arr(parsed.candidateScores) };
        return { ...result, parsed };
      } catch (error) {
        lastError = error;
        await this.appendRunLog({ type: 'llm_invalid_pass12', call: result.callNumber, explorationStep: this.state.step, retry, timestamp: new Date().toISOString(), error: error.message, rawResponse: result.raw, usage: result.usage, cumulativeUsage: { ...this.state.tokenUsage } });
        this.printCallSummary(result.usage, result.callNumber, `rejected/${error.message}`);
      }
    }
    throw new Error(`No valid Pass-1/Pass-2 semantic response after retry at step ${this.state.step}: ${lastError?.message || 'unknown error'}`);
  }
}
