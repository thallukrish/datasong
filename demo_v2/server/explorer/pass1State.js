import { Pass1ArcScheduler } from '../pass1ArcScheduler.js';
import { Pass2ArcExplorerState } from '../pass2ArcExplorerState.js';

const arr = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 400) => {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const clamp01 = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};

export const withPass1State = (Base) => class Pass1StateExplorer extends Base {
  emptyState() {
    const state = super.emptyState();
    state.pass1Scheduler = state.pass1Scheduler || { activeArcId: '', nextArcNumber: 1, decisions: [], fitHistory: [] };
    // Retained only as compatibility state for Pass2ArcExplorerState.seed() and
    // persisted maps. Modern Pass 2 never navigates this DFS state.
    state.pass2DfsByArc = state.pass2DfsByArc || {};
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

  semanticMode(observation) {
    return ['semantic_function', 'xml_file', 'config_file', 'text_file', 'semantic_neighborhood'].includes(observation?.kind);
  }

  compactCurrent(observation) {
    if (observation?.kind === 'xml_file' && typeof this.compactXmlCanonical === 'function') {
      return this.compactXmlCanonical(observation?.canonical || {});
    }
    return observation?.canonical || {};
  }

  compactCandidates(candidates) {
    return arr(candidates)
      .map((candidate) => typeof this.compactCandidate === 'function' ? this.compactCandidate(candidate) : candidate)
      .filter(Boolean);
  }

  normalizePass12(parsed, candidates = []) {
    const out = parsed && typeof parsed === 'object' ? parsed : {};
    out.meaning = text(out.meaning, 500);
    out.evidenceClassification = ['business_use_case', 'business_supporting', 'hypothesis', 'orientation', 'technical'].includes(out.evidenceClassification)
      ? out.evidenceClassification : 'orientation';

    out.arcFits = arr(out.arcFits).map((fit) => ({
      arcId: String(fit?.arcId || '').trim(),
      continuity: clamp01(fit?.continuity), coherence: clamp01(fit?.coherence), expectedGain: clamp01(fit?.expectedGain),
      reason: text(fit?.reason, 220)
    }));
    const seen = new Set(out.arcFits.map((fit) => fit.arcId));
    for (const arc of this.pass1().arcs()) {
      if (!seen.has(arc.id)) out.arcFits.push({ arcId: arc.id, continuity: 0, coherence: 0, expectedGain: 0, reason: '' });
    }

    out.hypothesisJudgments = arr(out.hypothesisJudgments).map((judgment) => ({
      hypothesisId: String(judgment?.hypothesisId || '').trim(),
      decision: ['admit', 'retain', 'reject'].includes(judgment?.decision) ? judgment.decision : 'retain',
      qualifiesAsBusinessUseCase: judgment?.qualifiesAsBusinessUseCase === true,
      businessActor: text(judgment?.businessActor, 260), businessIntent: text(judgment?.businessIntent, 300),
      confidence: clamp01(judgment?.confidence), reason: text(judgment?.reason, 300)
    }));

    out.newArcs = arr(out.newArcs || (out.newArc ? [out.newArc] : [])).map((seed) => {
      const qualification = ['business_use_case', 'hypothesis', 'orientation', 'technical'].includes(seed?.qualification)
        ? seed.qualification : (seed?.qualifiesAsBusinessUseCase === true ? 'business_use_case' : 'hypothesis');
      return {
        title: text(seed?.title, 180), concept: text(seed?.concept, 320), qualification,
        qualifiesAsBusinessUseCase: qualification === 'business_use_case' && seed?.qualifiesAsBusinessUseCase === true,
        businessActor: text(seed?.businessActor || seed?.actor || seed?.trigger, 260),
        businessIntent: text(seed?.businessIntent || seed?.intent, 300), confidence: clamp01(seed?.confidence),
        reason: text(seed?.reason, 300), trigger: text(seed?.trigger, 260), outcome: text(seed?.outcome, 260),
        majorStages: arr(seed?.majorStages).map((v) => text(v, 240)).filter(Boolean),
        entities: arr(seed?.entities).map((v) => text(v, 180)).filter(Boolean),
        relationships: arr(seed?.relationships).map((v) => text(v, 240)).filter(Boolean)
      };
    }).filter((seed) => seed.title);

    if (String(out.bestArc || '').toUpperCase() === 'NEW' && !out.newArcs.some((seed) => seed.qualifiesAsBusinessUseCase)) out.bestArc = 'UNATTACHED';

    const update = out.arcUpdate && typeof out.arcUpdate === 'object' ? out.arcUpdate : {};
    out.arcUpdate = {
      arcId: String(update.arcId || '').trim(),
      evidenceRole: ['major', 'supporting', 'trivial'].includes(update.evidenceRole) ? update.evidenceRole : 'supporting',
      title: text(update.title, 180), trigger: text(update.trigger, 300),
      majorStages: arr(update.majorStages).map((v) => text(v, 240)).filter(Boolean), outcome: text(update.outcome, 350),
      entities: arr(update.entities).map((v) => text(v, 180)).filter(Boolean),
      relationships: arr(update.relationships).map((v) => text(v, 240)).filter(Boolean),
      status: ['forming', 'broadly_complete', 'unresolved'].includes(update.status) ? update.status : 'forming'
    };

    const knownCandidateIds = new Set(arr(candidates).map((candidate) => candidate?.id));
    const admittedArcIds = new Set(this.pass1().arcs().map((arc) => arc.id));
    out.candidateScores = arr(out.candidateScores)
      .filter((score) => knownCandidateIds.has(score?.artifactId) && admittedArcIds.has(String(score?.arcId || '').trim()))
      .map((score) => ({ artifactId: score.artifactId, arcId: String(score?.arcId || '').trim(), continuity: clamp01(score?.continuity), coherence: clamp01(score?.coherence), expectedGain: clamp01(score?.expectedGain), reason: text(score?.reason, 220) }));

    const allowed = new Set(['advance', 'getArtifact', 'getFunction', 'getNeighbors', 'searchSemantic', 'backtrack', 'stop']);
    const request = out.evidenceRequest && typeof out.evidenceRequest === 'object' ? out.evidenceRequest : { type: 'advance' };
    if (!allowed.has(request.type)) request.type = out.candidateScores.length ? 'advance' : 'backtrack';
    out.evidenceRequest = request;
    out.next = request;
    out._pass12 = true;
    return out;
  }

  applyDelta(parsed, observation) {
    if (!parsed?._pass12) return super.applyDelta(parsed, observation);

    this._schedulerObservation = observation;
    const decision = this.pass1().consume(parsed, observation);
    if (!decision.evidenceArc && parsed.meaning) {
      this.state.unattachedFragments = arr(this.state.unattachedFragments);
      this.state.unattachedFragments.push({ artifactId: observation?.id || '', meaning: parsed.meaning });
      this.state.unattachedFragments = this.state.unattachedFragments.slice(-40);
    }
    this.state.lastMessage = decision.nextArc ? `Pass 1 scheduled ${decision.nextArc.title}.` : (parsed.meaning || 'Updated Pass-1 arc board.');
    if (typeof this.topology?.repositoryCoverageSnapshot === 'function') this.state.sourceCoverage = this.topology.repositoryCoverageSnapshot();
    return decision;
  }
};
