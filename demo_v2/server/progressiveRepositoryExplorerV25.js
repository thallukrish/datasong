import { ProgressiveRepositoryExplorerV24 } from './progressiveRepositoryExplorerV24.js';
import { DiscoveryArcExplorer } from './discoveryArcExplorer.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 360) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const DISCOVERY_SYSTEM = `You are DataSong's BUSINESS-USE-CASE ENTRANCE DISCOVERY navigator.
Your job in this phase is NOT to reconstruct a use case end to end. Your job is to identify promising entrances into business behavior from coarse repository evidence and progressively refine them.
Start from directories/files/top-level structured artifacts, then signatures or immediate XML/config children. Score visible paths by how likely they are to reveal a genuine business use case.
A business use case is something a business actor/end user/external business participant is trying to accomplish. Technical setup, framework wiring, registration, dependency/configuration mechanics and test harness lifecycle are evidence but not business-use-case entrances by themselves.
Use the compact prior discovery-start reasoning when scoring the next level. Confidence may rise or fall as evidence deepens. Once a start clearly qualifies, mark it qualified and stop deepening it in Discovery; Pass 2 will do the detailed reconstruction later.
Prefer breadth across promising entrances over deep technical drilling. Return strict compact JSON only.`;

export class ProgressiveRepositoryExplorerV25 extends ProgressiveRepositoryExplorerV24 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'discovery-entrances-pass1-scheduler-pass2-per-arc-dfs-v5';
    state.discovery = { status: 'active', nextStartNumber: 1, activeStartId: '', starts: [], decisions: [], qualifiedStartIds: [] };
    return state;
  }

  discovery() {
    if (!this._discoveryExplorer) this._discoveryExplorer = new DiscoveryArcExplorer(this);
    this._discoveryExplorer.ensureState();
    return this._discoveryExplorer;
  }

  discoveryActive() { return this.discovery().active(); }

  discoveryMode(observation) {
    return [
      'repo_directory', 'source_file_index', 'opaque_file',
      'semantic_function', 'xml_file', 'config_file', 'text_file', 'semantic_neighborhood'
    ].includes(observation?.kind);
  }

  discoveryCurrent(observation) {
    if (observation?.kind === 'xml_file') return this.compactXmlCanonical(observation?.canonical || {});
    if (observation?.canonical) return observation.canonical;
    return {
      id: observation?.id || '',
      path: observation?.path || '',
      kind: observation?.kind || '',
      summary: text(observation?.summary, 360)
    };
  }

  discoveryCandidates(candidates) {
    return arr(candidates).map((candidate) => this.compactCandidate(candidate)).filter(Boolean);
  }

  buildPrompt(observation, candidates) {
    if (!this.discoveryActive() || !this.discoveryMode(observation)) return super.buildPrompt(observation, candidates);

    const board = this.discovery().board();
    const active = this.discovery().activeStart();
    const current = this.discoveryCurrent(observation);
    const available = this.discoveryCandidates(candidates);

    const contract = {
      currentPathAssessment: {
        startId: 'active discovery start id or empty',
        businessUseCaseLikelihood: 0,
        qualifiesAsBusinessUseCase: false,
        suggestedArcTitle: 'refined business-use-case title if known',
        businessActor: 'actor/participant if evidenced',
        businessIntent: 'what they are trying to accomplish if evidenced',
        reason: 'why current evidence strengthens/weakens this entrance'
      },
      candidateDiscoveryScores: [{
        artifactId: 'exact supplied candidate id',
        startId: 'existing discovery start id when continuing it, otherwise empty',
        suggestedArcTitle: 'candidate business-use-case entrance',
        businessUseCaseLikelihood: 0,
        qualifiesAsBusinessUseCase: false,
        businessActor: 'if evidenced',
        businessIntent: 'if evidenced',
        pursue: true,
        reason: 'why this next level is or is not promising'
      }],
      discoveryComplete: false,
      completionReason: 'true only when a useful first set of qualified entrances exists and remaining visible paths are materially less promising'
    };

    return `MODE business-use-case-entrance-discovery\nDISCOVERY_STARTS ${JSON.stringify(board)}\nACTIVE_START ${JSON.stringify(active ? { id: active.id, title: active.title, reason: active.reason, confidence: active.confidence } : null)}\nCURRENT ${JSON.stringify(current)}\nNEXT_LEVEL ${JSON.stringify(available)}\nRETURN ${JSON.stringify(contract)}\nRules:\n- Score supplied NEXT_LEVEL items for their likelihood of revealing a BUSINESS USE CASE, not technical importance.\n- Use an existing startId only when the new item continues that same suspected entrance. Leave startId empty to create a distinct discovery start.\n- The score is the CURRENT confidence after considering the compact prior trail plus this new evidence; it may rise or fall.\n- Once a start qualifies, do not keep drilling into it during Discovery. Look for other promising entrances; Pass 2 will reconstruct qualified arcs later.\n- Candidate names/signatures/top-level hierarchy are evidence hints, not proof.\n- Prefer breadth and shallow refinement. Do not chase framework/configuration internals merely because they are connected.\n- Set discoveryComplete only when the useful first set of business-use-case entrances has been identified well enough to hand to Pass 1/Pass 2.\n- Keep reasons short.`;
  }

  async callModel(dynamicPrompt) {
    if (String(dynamicPrompt || '').startsWith('MODE business-use-case-entrance-discovery')) {
      return this.lightweightModelCall(DISCOVERY_SYSTEM, dynamicPrompt, 'BUSINESS-USE-CASE ENTRANCE DISCOVERY');
    }
    return super.callModel(dynamicPrompt);
  }

  normalizeDiscovery(raw, candidates) {
    const out = raw && typeof raw === 'object' ? raw : {};
    const assessment = out.currentPathAssessment && typeof out.currentPathAssessment === 'object' ? out.currentPathAssessment : {};
    out.currentPathAssessment = {
      startId: String(assessment.startId || '').trim(),
      businessUseCaseLikelihood: clamp01(assessment.businessUseCaseLikelihood),
      qualifiesAsBusinessUseCase: assessment.qualifiesAsBusinessUseCase === true,
      suggestedArcTitle: text(assessment.suggestedArcTitle, 180),
      businessActor: text(assessment.businessActor, 220),
      businessIntent: text(assessment.businessIntent, 280),
      reason: text(assessment.reason, 280)
    };

    const known = new Set(arr(candidates).map((c) => c.id));
    out.candidateDiscoveryScores = arr(out.candidateDiscoveryScores)
      .filter((score) => known.has(score?.artifactId))
      .map((score) => ({
        artifactId: score.artifactId,
        startId: String(score?.startId || '').trim(),
        suggestedArcTitle: text(score?.suggestedArcTitle, 180),
        businessUseCaseLikelihood: clamp01(score?.businessUseCaseLikelihood),
        qualifiesAsBusinessUseCase: score?.qualifiesAsBusinessUseCase === true,
        businessActor: text(score?.businessActor, 220),
        businessIntent: text(score?.businessIntent, 280),
        pursue: score?.pursue !== false,
        reason: text(score?.reason, 280)
      }));
    out.discoveryComplete = out.discoveryComplete === true;
    out.completionReason = text(out.completionReason, 300);
    out._discovery = true;
    out.next = { type: 'advance' };
    return out;
  }

  async getSemanticUpdate(args) {
    if (!this.discoveryActive() || !this.discoveryMode(args.observation)) return super.getSemanticUpdate(args);

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
        const parsed = this.normalizeDiscovery(JSON.parse(result.raw), args.candidates);
        this._lastDiscoveryCandidates = arr(args.candidates);
        return { ...result, parsed };
      } catch (error) {
        lastError = error;
        await this.appendRunLog({
          type: 'llm_invalid_discovery', call: result.callNumber, explorationStep: this.state.step,
          retry, timestamp: new Date().toISOString(), error: error.message, rawResponse: result.raw,
          usage: result.usage, cumulativeUsage: { ...this.state.tokenUsage }
        });
        this.printCallSummary(result.usage, result.callNumber, `rejected/${error.message}`);
      }
    }
    throw new Error(`No valid Discovery response after retry at step ${this.state.step}: ${lastError?.message || 'unknown error'}`);
  }

  syncDiscoveryStories() {
    if (!this.discoveryActive()) return;
    this.state.stories = this.discovery().starts().map((start) => ({
      id: start.id,
      title: start.title,
      nature: 'business-use-case discovery entrance',
      status: start.status,
      progress: Math.round(clamp01(start.confidence) * 100),
      steps: arr(start.trail).map((item, index) => ({
        id: `${start.id}-d${index + 1}`,
        artifactId: item.artifactId,
        meaning: item.reason,
        relation: 'discovery',
        continuity: item.confidence,
        coherenceGain: item.confidence,
        placementConfidence: 1
      })),
      branches: [], dependencies: [], openQuestions: [],
      recentGain: start.confidence,
      evidence: arr(start.trail).map((item) => item.artifactId)
    }));
  }

  seedQualifiedArcs(qualified) {
    const created = [];
    for (const start of qualified) {
      const arc = this.pass1().createArc({
        title: start.title,
        concept: start.reason,
        businessActor: start.businessActor,
        businessIntent: start.businessIntent,
        confidence: start.confidence,
        qualifiesAsBusinessUseCase: true,
        qualification: 'business_use_case'
      }, { id: start.startArtifactId || start.currentArtifactId || '', path: start.startArtifactId || '' });
      if (!arc) continue;
      arc.discoveryStartId = start.id;
      arc.discoveryStartArtifactId = start.startArtifactId || start.currentArtifactId || '';
      created.push(arc);
    }
    const chosen = this.pass1().chooseNextArc(created[0]?.id || '');
    for (const arc of created) this.pass2().seed(arc.id);
    if (chosen) {
      const source = this.discovery().startByReference(chosen.discoveryStartId) || qualified.find((s) => s.id === chosen.discoveryStartId) || qualified[0];
      this._discoveryTransition = { arcId: chosen.id, artifactId: source?.startArtifactId || source?.currentArtifactId || '' };
    }
    this.pass1().syncStories();
  }

  applyDelta(parsed, observation) {
    if (!parsed?._discovery) return super.applyDelta(parsed, observation);

    const decision = this.discovery().consume(parsed, observation, this._lastDiscoveryCandidates || []);
    this._discoveryChosen = decision.chosen;
    if (decision.completed) this.seedQualifiedArcs(decision.qualified);
    else this.syncDiscoveryStories();

    this.state.lastMessage = decision.completed
      ? `Discovery qualified ${decision.qualified.length} business-use-case entrance${decision.qualified.length === 1 ? '' : 's'}; handing them to Pass 1.`
      : (decision.chosen?.start ? `Discovery pursuing ${decision.chosen.start.title}.` : 'Discovery is looking for a stronger business-use-case entrance.');
  }

  async observeDiscoveryCandidate(candidate) {
    if (!candidate?.id) return null;
    this.removeFrontier(candidate.id);
    this.recordTraversalEdge(this._currentObservationId || '', candidate.id, candidate.relation || 'discovery_best_first', 'traversed');
    if (candidate.kind === 'directory' || String(candidate.id).startsWith('dir:')) {
      const p = candidate.path || String(candidate.id).replace(/^dir:/, '');
      return this.topology.listDirectory(p);
    }
    if (String(candidate.id).startsWith('semantic:') && this.topology.symbolById?.has(candidate.id)) {
      return this.topology.getFunction(candidate.id);
    }
    return this.topology.getArtifact(candidate.id);
  }

  broadDiscoveryFallback() {
    return arr(this.state.frontier)
      .filter((candidate) => candidate?.id && !this.state.visited.includes(candidate.id))
      .filter((candidate) => String(candidate.id).startsWith('dir:') || String(candidate.id).startsWith('file:'))
      .sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a))[0] || null;
  }

  async resolveNextAction(action, candidates) {
    if (!this.discoveryActive()) {
      if (this._discoveryTransition) {
        const transition = this._discoveryTransition;
        this._discoveryTransition = null;
        const startId = transition.artifactId;
        if (startId) {
          if (String(startId).startsWith('semantic:') && this.topology.symbolById?.has(startId)) return this.topology.getFunction(startId);
          return this.topology.getArtifact(startId);
        }
      }
      return super.resolveNextAction(action, candidates);
    }

    const chosen = this._discoveryChosen?.candidate || null;
    this._discoveryChosen = null;
    // Qualified starts are frozen in Discovery. If the best scored continuation
    // belongs to one, move to another visible/broad entrance instead of deepening it.
    if (chosen) {
      const start = this.discovery().startByReference(this.discovery().activeStartId || '');
      if (!start || start.status !== 'qualified') return this.observeDiscoveryCandidate(chosen);
    }

    const fallback = this.broadDiscoveryFallback();
    if (fallback) return this.observeDiscoveryCandidate(fallback);
    return null;
  }
}
