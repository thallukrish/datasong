import { ProgressiveRepositoryExplorerV23 } from './progressiveRepositoryExplorerV23.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
function normPath(value = '') { return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''); }

export class ProgressiveRepositoryExplorerV24 extends ProgressiveRepositoryExplorerV23 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'pass1-admission-goal-directed-prearc-pass2-per-arc-dfs-v4';
    state.preAdmissionExploration = { steps: [], signalHistory: [], flattenedBranches: [] };
    return state;
  }

  hypothesisSnapshot() {
    return new Map(this.pass1().hypotheses().map((h) => [h.id, {
      confidence: clamp01(h.confidence), status: h.status || 'hypothesis'
    }]));
  }

  applyDelta(parsed, observation) {
    if (this.hasAdmittedArc() || !parsed?._pass12) return super.applyDelta(parsed, observation);

    const before = this.hypothesisSnapshot();
    const classification = String(parsed.evidenceClassification || 'orientation');
    const result = super.applyDelta(parsed, observation);
    const after = this.hypothesisSnapshot();

    let strengthened = false;
    const changes = [];
    for (const [id, current] of after) {
      const previous = before.get(id);
      const isNew = !previous;
      const admitted = current.status === 'admitted';
      const confidenceGain = previous ? current.confidence - previous.confidence : current.confidence;
      const improved = admitted || confidenceGain > 0;
      if (improved) strengthened = true;
      changes.push({ id, previousConfidence: previous?.confidence ?? null, confidence: current.confidence, confidenceGain, status: current.status, isNew, improved });
    }

    const activeHypotheses = this.pass1().hypotheses().filter((h) => h.status === 'hypothesis');
    const hasHypothesis = activeHypotheses.length > 0;
    const flat = hasHypothesis && !strengthened && ['orientation', 'technical', 'hypothesis', 'business_supporting'].includes(classification);

    this._preAdmissionSignal = { step: this.state.step, artifactId: observation?.id || '', classification, strengthened, flat, changes };
    this.state.preAdmissionExploration.signalHistory.push(this._preAdmissionSignal);
    this.state.preAdmissionExploration.signalHistory = this.state.preAdmissionExploration.signalHistory.slice(-160);
    return result;
  }

  sourcePathForArtifactId(id = '') {
    const raw = String(id || '');
    if (raw.startsWith('semantic:')) return normPath(raw.slice('semantic:'.length).split('#')[0]);
    if (raw.startsWith('file:')) return normPath(raw.slice('file:'.length));
    if (raw.startsWith('xmlnode:')) {
      const encoded = raw.slice('xmlnode:'.length).split(':')[0];
      try { return normPath(decodeURIComponent(encoded)); } catch { return normPath(encoded); }
    }
    return '';
  }

  broadPreAdmissionCandidate() {
    const currentSource = this.sourcePathForArtifactId(this._currentObservationId || this.state.currentArtifact?.id || '');
    const unvisited = arr(this.state.frontier).filter((c) => c?.id && !this.state.visited.includes(c.id));
    const broad = unvisited.filter((c) => {
      const id = String(c.id || '');
      if (!(id.startsWith('file:') || id.startsWith('dir:'))) return false;
      const p = normPath(c.path || id.replace(/^(file|dir):/, ''));
      return !currentSource || p !== currentSource;
    });
    const pool = broad.length ? broad : unvisited.filter((c) => this.sourcePathForArtifactId(c.id) !== currentSource);
    return [...pool].sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a))[0] || null;
  }

  async resolvePreAdmission(request, candidates) {
    // A retained hypothesis only earns another local step when the just-inspected
    // evidence strengthened its qualification. Flat/declining qualification
    // means this local branch is no longer informative: park the hypothesis and
    // return to broader evidence discovery. This is semantic drift control, not
    // a step/token budget.
    if (this._preAdmissionSignal?.flat) {
      const fallback = this.broadPreAdmissionCandidate();
      this.state.preAdmissionExploration.flattenedBranches.push({
        step: this.state.step,
        fromArtifactId: this._currentObservationId || '',
        reason: 'business-use-case qualification did not strengthen',
        signal: this._preAdmissionSignal,
        resumedArtifactId: fallback?.id || ''
      });
      this.state.preAdmissionExploration.flattenedBranches = this.state.preAdmissionExploration.flattenedBranches.slice(-120);
      this._preAdmissionSignal = null;
      if (fallback) {
        this.removeFrontier(fallback.id);
        this.recordTraversalEdge(this._currentObservationId || '', fallback.id, fallback.relation || 'pre_admission_signal_escape', 'traversed');
        this.recordPreAdmission({ type: 'signalEscape', reason: 'qualification signal flat; seek broader business evidence' }, fallback.id);
        return this.topology.getArtifact(fallback.id);
      }
    }
    this._preAdmissionSignal = null;
    return super.resolvePreAdmission(request, candidates);
  }

  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);
    if (!this.semanticMode(observation) || this.hasAdmittedArc()) return base;
    return `${base}\nPRE-ADMISSION AIM: every local inspection must increase evidence that a hypothesis is a genuine business use case. If CURRENT does not strengthen a hypothesis, do not drill deeper into the same technical branch; request broader/search evidence instead. Retaining a hypothesis means preserve it for later evidence, not keep following the current path.`;
  }
}
