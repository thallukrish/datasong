import { ProgressiveRepositoryExplorerV25 } from './progressiveRepositoryExplorerV25.js';
import { ScoutLayer } from './scoutLayer.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 360) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const SCOUT_SYSTEM = `You are DataSong's global BUSINESS-USE-CASE SCOUT.
You do not continue the currently active arc and you do not reconstruct any use case deeply.
Your only job is to challenge the current arc board: inspect broad unexplored repository evidence and identify materially NEW business-use-case directions that are not already represented by known qualified arcs or discovery starts.
A useful new direction should plausibly expose something a business actor/end user/external business participant is trying to accomplish. Technical/framework/configuration novelty is not business-use-case novelty.
Use names, paths and lightweight artifact signatures only. Do not infer bodies that were not supplied.
Return strict compact JSON.`;

export class ProgressiveRepositoryExplorerV26 extends ProgressiveRepositoryExplorerV25 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'scout-discovery-pass1-pass2-v6';
    state.scout = { runs: [], signalByArc: {}, lastFingerprint: '', pendingReason: '', discoveredStartIds: [] };
    return state;
  }

  scout() {
    if (!this._scoutLayer) this._scoutLayer = new ScoutLayer(this);
    this._scoutLayer.ensureState();
    return this._scoutLayer;
  }

  pendingScoutStarts() {
    const ids = new Set(arr(this.state.scout?.discoveredStartIds));
    return this.discovery().starts().filter((start) => ids.has(start.id) && start.status === 'candidate');
  }

  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);
    if (!this.discoveryActive() || !this.pendingScoutStarts().length) return base;
    return `${base}\nSCOUT-REOPENED DISCOVERY: one or more globally novel directions were just seeded by Scout. Refine those candidate starts shallowly before declaring Discovery complete. Existing qualified starts are already known; do not spend Discovery calls deepening them.`;
  }

  normalizeDiscovery(raw, candidates) {
    const out = super.normalizeDiscovery(raw, candidates);
    if (this.pendingScoutStarts().length) out.discoveryComplete = false;
    return out;
  }

  applyDelta(parsed, observation) {
    const beforeArcCount = this.pass1().arcs().length;
    const result = super.applyDelta(parsed, observation);

    if (!parsed?._discovery && parsed?._pass12 && !this.discoveryActive()) {
      const afterArcCount = this.pass1().arcs().length;
      if (afterArcCount > beforeArcCount) {
        // A genuinely new arc was just admitted, so the board itself changed;
        // there is no need to challenge it immediately.
        this.scout().ensureState().pendingReason = '';
      } else {
        this.scout().notePass2Signal(parsed);
      }
    }
    return result;
  }

  scoutPrompt(candidates) {
    const knownArcs = this.pass1().arcBoard();
    const knownStarts = this.discovery().board();
    const explored = this.scout().exploredSummary();
    const broad = arr(candidates).map((candidate) => this.compactCandidate(candidate)).filter(Boolean);
    const reason = this.scout().ensureState().pendingReason || 'periodic novelty check';
    const contract = {
      summary: 'brief global novelty assessment',
      newDirections: [{
        artifactId: 'exact supplied broad candidate id',
        novel: true,
        novelty: 0,
        businessUseCaseLikelihood: 0,
        suggestedArcTitle: 'possible distinct business-use-case entrance',
        businessActor: 'if evidenced',
        businessIntent: 'if evidenced',
        pursue: true,
        reason: 'why this is materially different from known arcs/starts'
      }]
    };
    return `MODE global-business-use-case-scout\nTRIGGER ${JSON.stringify(reason)}\nKNOWN_QUALIFIED_ARCS ${JSON.stringify(knownArcs)}\nKNOWN_DISCOVERY_STARTS ${JSON.stringify(knownStarts)}\nEXPLORED_EVIDENCE_REGIONS ${JSON.stringify(explored)}\nBROAD_UNEXPLORED_EVIDENCE ${JSON.stringify(broad)}\nRETURN ${JSON.stringify(contract)}\nRules:\n- Look specifically for business-use-case directions NOT already represented by KNOWN_QUALIFIED_ARCS or KNOWN_DISCOVERY_STARTS.\n- Score novelty separately from business-use-case likelihood. Both must be meaningful for a direction to be useful.\n- Do not select another artifact merely because it continues the active arc; Scout exists to challenge exploitation bias.\n- Technical/config/framework differences are not business-use-case novelty.\n- Copy artifactId exactly from BROAD_UNEXPLORED_EVIDENCE.\n- Return an empty newDirections array when nothing genuinely new is visible.`;
  }

  async callModel(dynamicPrompt) {
    if (String(dynamicPrompt || '').startsWith('MODE global-business-use-case-scout')) {
      return this.lightweightModelCall(SCOUT_SYSTEM, dynamicPrompt, 'GLOBAL BUSINESS-USE-CASE SCOUT');
    }
    return super.callModel(dynamicPrompt);
  }

  normalizeScout(raw, candidates) {
    const known = new Set(arr(candidates).map((candidate) => candidate.id));
    return {
      summary: text(raw?.summary, 400),
      newDirections: arr(raw?.newDirections)
        .filter((item) => known.has(item?.artifactId))
        .map((item) => ({
          artifactId: item.artifactId,
          novel: item?.novel !== false,
          novelty: clamp01(item?.novelty),
          businessUseCaseLikelihood: clamp01(item?.businessUseCaseLikelihood),
          suggestedArcTitle: text(item?.suggestedArcTitle, 180),
          businessActor: text(item?.businessActor, 220),
          businessIntent: text(item?.businessIntent, 280),
          pursue: item?.pursue !== false,
          reason: text(item?.reason, 300)
        }))
    };
  }

  async runScout(candidates) {
    const before = this.snapshot();
    const observation = {
      id: `scout:${this.state.step}`,
      path: 'global novelty scout',
      kind: 'scout_review',
      canonical: { phase: 'scout' }
    };
    const dynamicPrompt = this.scoutPrompt(candidates);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${dynamicPrompt}\nRETRY: return complete valid JSON only.` : dynamicPrompt;
      const result = await this.callAndRecordAttempt({
        dynamicPrompt: prompt,
        observation,
        candidates,
        before,
        maxTokens: undefined,
        retry
      });
      try {
        const parsed = this.normalizeScout(JSON.parse(result.raw), candidates);
        const chosen = this.scout().consumeScoutResult(parsed, candidates);
        await this.appendRunLog({
          type: 'scout_applied',
          call: result.callNumber,
          explorationStep: this.state.step,
          retry,
          timestamp: new Date().toISOString(),
          trigger: before.scout?.pendingReason || '',
          parsedResponse: parsed,
          chosenStartId: chosen?.start?.id || '',
          chosenArtifactId: chosen?.direction?.artifactId || ''
        });
        this.printCallSummary(result.usage, result.callNumber, chosen ? 'scout found novel direction' : 'scout found no novel direction');
        return chosen;
      } catch (error) {
        lastError = error;
        await this.appendRunLog({
          type: 'llm_invalid_scout', call: result.callNumber, explorationStep: this.state.step,
          retry, timestamp: new Date().toISOString(), error: error.message, rawResponse: result.raw,
          usage: result.usage, cumulativeUsage: { ...this.state.tokenUsage }
        });
        this.printCallSummary(result.usage, result.callNumber, `rejected/${error.message}`);
      }
    }
    throw new Error(`No valid Scout response after retry at step ${this.state.step}: ${lastError?.message || 'unknown error'}`);
  }

  async resolveNextAction(action, candidates) {
    if (!this.discoveryActive()) {
      const broad = this.scout().broadCandidates();
      if (this.scout().shouldRun(broad)) {
        const chosen = await this.runScout(broad);
        if (chosen?.direction?.candidate) return this.observeDiscoveryCandidate(chosen.direction.candidate);
        if (chosen?.direction?.artifactId) {
          const candidate = broad.find((item) => item.id === chosen.direction.artifactId);
          if (candidate) return this.observeDiscoveryCandidate(candidate);
        }
        // Scout found nothing novel; continue the currently scheduled Pass-1/Pass-2 path.
      }
    }
    return super.resolveNextAction(action, candidates);
  }
}
