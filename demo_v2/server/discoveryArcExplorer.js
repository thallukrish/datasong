function arr(value) { return Array.isArray(value) ? value : []; }
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
function text(value, max = 320) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export class DiscoveryArcExplorer {
  constructor(explorer) { this.explorer = explorer; }
  state() { return this.explorer.state; }

  ensureState() {
    const state = this.state();
    if (!state.discovery) {
      state.discovery = {
        status: 'active',
        nextStartNumber: 1,
        activeStartId: '',
        starts: [],
        decisions: [],
        qualifiedStartIds: []
      };
    }
    return state.discovery;
  }

  active() { return this.ensureState().status === 'active'; }
  starts() { return this.ensureState().starts; }
  activeStart() {
    const d = this.ensureState();
    return this.starts().find((s) => s.id === d.activeStartId) || null;
  }

  startByReference(value) {
    const key = String(value || '').trim().toLowerCase();
    if (!key) return null;
    return this.starts().find((s) => s.id.toLowerCase() === key || String(s.title || '').toLowerCase() === key) || null;
  }

  board() {
    return this.starts().map((s) => ({
      id: s.id,
      title: s.title,
      reason: s.reason,
      confidence: Number(s.confidence || 0).toFixed(2),
      status: s.status,
      actor: s.businessActor || '',
      intent: s.businessIntent || '',
      currentArtifactId: s.currentArtifactId || '',
      trail: arr(s.trail).slice(-4).map((t) => ({ artifactId: t.artifactId, confidence: t.confidence, reason: t.reason }))
    }));
  }

  createStart(seed = {}) {
    const d = this.ensureState();
    const title = text(seed.title || seed.suggestedArcTitle || 'Promising business-use-case entrance', 180);
    const artifactId = String(seed.artifactId || '').trim();
    let existing = artifactId ? this.starts().find((s) => s.startArtifactId === artifactId) : null;
    if (!existing && title) existing = this.starts().find((s) => String(s.title || '').toLowerCase() === title.toLowerCase());
    if (existing) return existing;
    const start = {
      id: `discover-${d.nextStartNumber++}`,
      title,
      reason: text(seed.reason, 300),
      confidence: clamp01(seed.businessUseCaseLikelihood ?? seed.confidence),
      status: seed.qualifiesAsBusinessUseCase === true ? 'qualified' : 'candidate',
      businessActor: text(seed.businessActor, 220),
      businessIntent: text(seed.businessIntent, 280),
      startArtifactId: artifactId,
      currentArtifactId: artifactId,
      createdStep: this.state().step,
      updatedStep: this.state().step,
      trail: artifactId ? [{
        step: this.state().step,
        artifactId,
        confidence: clamp01(seed.businessUseCaseLikelihood ?? seed.confidence),
        reason: text(seed.reason, 260)
      }] : []
    };
    this.starts().push(start);
    if (start.status === 'qualified' && !d.qualifiedStartIds.includes(start.id)) d.qualifiedStartIds.push(start.id);
    return start;
  }

  updateStart(start, update = {}, artifactId = '') {
    if (!start) return null;
    const d = this.ensureState();
    if (text(update.suggestedArcTitle || update.title, 180)) start.title = text(update.suggestedArcTitle || update.title, 180);
    if (text(update.reason, 300)) start.reason = text(update.reason, 300);
    start.confidence = clamp01(update.businessUseCaseLikelihood ?? update.confidence ?? start.confidence);
    start.businessActor = text(update.businessActor, 220) || start.businessActor;
    start.businessIntent = text(update.businessIntent, 280) || start.businessIntent;
    if (artifactId) {
      start.currentArtifactId = artifactId;
      start.trail.push({
        step: this.state().step,
        artifactId,
        confidence: start.confidence,
        reason: text(update.reason, 260)
      });
      start.trail = start.trail.slice(-20);
    }
    if (update.qualifiesAsBusinessUseCase === true) {
      start.status = 'qualified';
      if (!d.qualifiedStartIds.includes(start.id)) d.qualifiedStartIds.push(start.id);
    } else if (update.pursue === false && start.status !== 'qualified') {
      start.status = 'deprioritized';
    } else if (start.status !== 'qualified') {
      start.status = 'candidate';
    }
    start.updatedStep = this.state().step;
    return start;
  }

  consume(parsed, observation, candidates) {
    const d = this.ensureState();
    const currentAssessment = parsed?.currentPathAssessment || {};
    const active = this.startByReference(currentAssessment.startId) || this.activeStart();
    if (active) this.updateStart(active, currentAssessment, observation?.id || active.currentArtifactId);

    const byCandidateId = new Map(arr(candidates).map((c) => [c.id, c]));
    const scored = [];
    for (const score of arr(parsed?.candidateDiscoveryScores)) {
      if (!byCandidateId.has(score?.artifactId)) continue;
      let start = this.startByReference(score?.startId);
      if (!start && score?.pursue !== false) start = this.createStart(score);
      if (start) this.updateStart(start, score, score.artifactId);
      scored.push({ score, start, candidate: byCandidateId.get(score.artifactId) });
    }

    const ranked = scored
      .filter((x) => x.score?.pursue !== false && x.candidate)
      .sort((a, b) => clamp01(b.score.businessUseCaseLikelihood) - clamp01(a.score.businessUseCaseLikelihood));
    const chosen = ranked[0] || null;
    if (chosen?.start) d.activeStartId = chosen.start.id;

    const qualified = this.starts().filter((s) => s.status === 'qualified');
    const canComplete = parsed?.discoveryComplete === true && qualified.length > 0;
    if (canComplete) d.status = 'complete';

    d.decisions.push({
      step: this.state().step,
      observedArtifactId: observation?.id || '',
      activeStartId: d.activeStartId,
      chosenArtifactId: chosen?.candidate?.id || '',
      qualifiedStartIds: qualified.map((s) => s.id),
      discoveryCompleteRequested: parsed?.discoveryComplete === true,
      completed: canComplete
    });
    d.decisions = d.decisions.slice(-240);

    return { chosen, qualified, completed: canComplete };
  }
}
