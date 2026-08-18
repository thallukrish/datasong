function arr(value) { return Array.isArray(value) ? value : []; }
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
function text(value, max = 300) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function uniq(values) { return [...new Set(arr(values).map((v) => text(v, 240)).filter(Boolean))]; }

export class Pass1ArcScheduler {
  constructor(explorer) { this.explorer = explorer; }

  state() { return this.explorer.state; }

  ensureState() {
    const state = this.state();
    if (!state.pass1Scheduler) {
      state.pass1Scheduler = {
        activeArcId: '',
        nextArcNumber: 1,
        decisions: [],
        fitHistory: []
      };
    }
    if (!Array.isArray(state.pass1Arcs)) state.pass1Arcs = [];
    for (const arc of state.pass1Arcs) this.ensureArcIdentity(arc);
    return state.pass1Scheduler;
  }

  ensureArcIdentity(arc) {
    const scheduler = this.state().pass1Scheduler || this.ensureState();
    if (!arc.id) arc.id = `arc-${scheduler.nextArcNumber++}`;
    if (!Number.isFinite(Number(arc.progress))) arc.progress = 0;
    if (!Number.isFinite(Number(arc.opportunityScore))) arc.opportunityScore = 0;
    if (!Number.isFinite(Number(arc.lastScheduledStep))) arc.lastScheduledStep = 0;
    if (!Array.isArray(arc.majorStages)) arc.majorStages = [];
    if (!Array.isArray(arc.entities)) arc.entities = [];
    if (!Array.isArray(arc.relationships)) arc.relationships = [];
    if (!Array.isArray(arc.evidence)) arc.evidence = [];
    if (!arc.status) arc.status = 'forming';
    return arc;
  }

  arcs() {
    this.ensureState();
    return this.state().pass1Arcs;
  }

  activeArcId() { return this.ensureState().activeArcId || ''; }
  activeArc() { return this.arcs().find((arc) => arc.id === this.activeArcId()) || null; }

  arcBoard() {
    return this.arcs().map((arc) => ({
      id: arc.id,
      title: arc.title,
      status: arc.status,
      progress: arc.progress,
      trigger: arc.trigger || '',
      stages: arr(arc.majorStages).slice(-8),
      outcome: arc.outcome || '',
      opportunity: Number(arc.opportunityScore || 0).toFixed(2)
    }));
  }

  scoreFit(fit) {
    return 0.45 * clamp01(fit?.continuity)
      + 0.45 * clamp01(fit?.coherence)
      + 0.10 * clamp01(fit?.expectedGain);
  }

  arcByReference(value) {
    const key = String(value || '').trim().toLowerCase();
    if (!key) return null;
    return this.arcs().find((arc) => arc.id.toLowerCase() === key || String(arc.title || '').trim().toLowerCase() === key) || null;
  }

  createArc(seed, observation) {
    const title = text(seed?.title, 180);
    if (!title) return null;
    const existing = this.arcs().find((arc) => String(arc.title || '').toLowerCase() === title.toLowerCase());
    if (existing) {
      existing.opportunityScore = Math.max(Number(existing.opportunityScore || 0), clamp01(seed?.confidence));
      return existing;
    }
    const arc = this.ensureArcIdentity({
      title,
      concept: text(seed?.concept || seed?.reason, 320),
      trigger: text(seed?.trigger, 300),
      majorStages: uniq(seed?.majorStages),
      outcome: text(seed?.outcome, 320),
      entities: uniq(seed?.entities),
      relationships: uniq(seed?.relationships),
      status: 'forming',
      progress: 0,
      opportunityScore: Math.max(0.35, clamp01(seed?.confidence)),
      createdStep: this.state().step,
      updatedStep: this.state().step,
      lastScheduledStep: 0,
      evidence: observation?.id ? [{ step: this.state().step, artifactId: observation.id, meaning: text(seed?.reason || seed?.concept, 300), role: 'seed' }] : []
    });
    this.state().pass1Arcs.push(arc);
    return arc;
  }

  updateFitState(parsed) {
    const scheduler = this.ensureState();
    const seen = new Set();
    for (const fit of arr(parsed?.arcFits)) {
      const arc = this.arcByReference(fit?.arcId);
      if (!arc) continue;
      const score = this.scoreFit(fit);
      seen.add(arc.id);
      arc.lastFit = {
        step: this.state().step,
        continuity: clamp01(fit?.continuity),
        coherence: clamp01(fit?.coherence),
        expectedGain: clamp01(fit?.expectedGain),
        score
      };
      // Preserve promising opportunities instead of replacing them with a later
      // weak fit from unrelated evidence. Old opportunities decay gently.
      arc.opportunityScore = Math.max(Number(arc.opportunityScore || 0) * 0.96, score);
      scheduler.fitHistory.push({ step: this.state().step, arcId: arc.id, ...arc.lastFit });
    }
    for (const arc of this.arcs()) {
      if (!seen.has(arc.id)) arc.opportunityScore = Number(arc.opportunityScore || 0) * 0.985;
    }
    scheduler.fitHistory = scheduler.fitHistory.slice(-300);

    for (const seed of arr(parsed?.newArcs)) {
      if (clamp01(seed?.confidence) >= 0.25 || text(seed?.title)) this.createArc(seed, this.explorer._schedulerObservation);
    }
  }

  selectEvidenceArc(parsed) {
    const explicit = this.arcByReference(parsed?.bestArc);
    const ranked = arr(parsed?.arcFits)
      .map((fit) => ({ fit, arc: this.arcByReference(fit?.arcId), score: this.scoreFit(fit) }))
      .filter((entry) => entry.arc)
      .sort((a, b) => b.score - a.score);

    if (explicit && ranked.some((entry) => entry.arc.id === explicit.id && entry.score >= 0.25)) return explicit;
    if (ranked[0]?.score >= 0.25) return ranked[0].arc;

    if (String(parsed?.bestArc || '').toUpperCase() === 'NEW') {
      const seed = arr(parsed?.newArcs)[0] || parsed?.newArc;
      return this.createArc(seed, this.explorer._schedulerObservation);
    }
    return null;
  }

  mergeArcUpdate(arc, parsed, observation) {
    if (!arc) return;
    const update = parsed?.arcUpdate && typeof parsed.arcUpdate === 'object' ? parsed.arcUpdate : {};
    if (text(update.title, 180)) arc.title = text(update.title, 180);
    if (text(update.trigger, 300)) arc.trigger = text(update.trigger, 300);
    if (text(update.outcome, 350)) arc.outcome = text(update.outcome, 350);
    arc.majorStages = uniq([...arr(arc.majorStages), ...arr(update.majorStages)]);
    arc.entities = uniq([...arr(arc.entities), ...arr(update.entities)]);
    arc.relationships = uniq([...arr(arc.relationships), ...arr(update.relationships)]);
    if (['forming', 'broadly_complete', 'unresolved'].includes(update.status)) arc.status = update.status;
    if (observation?.id && !arc.evidence.some((item) => item.artifactId === observation.id)) {
      arc.evidence.push({
        step: this.state().step,
        artifactId: observation.id,
        meaning: text(parsed?.meaning, 400),
        role: text(update.evidenceRole || 'supporting', 40)
      });
      arc.evidence = arc.evidence.slice(-80);
    }
    arc.updatedStep = this.state().step;
    arc.progress = Math.max(Number(arc.progress || 0), this.computeProgress(arc));
  }

  computeProgress(arc) {
    let p = 0;
    if (arc.trigger) p += 12;
    p += Math.min(42, arr(arc.majorStages).length * 7);
    if (arc.outcome) p += 16;
    if (arr(arc.entities).length) p += Math.min(10, 4 + arr(arc.entities).length * 2);
    if (arr(arc.relationships).length) p += Math.min(10, 4 + arr(arc.relationships).length * 2);
    if (arc.status === 'broadly_complete') p = Math.max(p, 90);
    return Math.min(96, Math.round(p));
  }

  updateCandidateOpportunities(parsed) {
    const byArc = new Map();
    for (const item of arr(parsed?.candidateScores)) {
      const arc = this.arcByReference(item?.arcId);
      if (!arc) continue;
      const score = this.scoreFit(item);
      const current = byArc.get(arc.id) || 0;
      if (score > current) byArc.set(arc.id, score);
    }
    for (const [arcId, score] of byArc) {
      const arc = this.arcByReference(arcId);
      if (arc) arc.opportunityScore = Math.max(Number(arc.opportunityScore || 0), score);
    }
  }

  chooseNextArc(preferredArcId = '') {
    const scheduler = this.ensureState();
    const step = Number(this.state().step || 0);
    const ranked = this.arcs()
      .filter((arc) => arc.status !== 'broadly_complete' || Number(arc.opportunityScore || 0) >= 0.45)
      .map((arc) => {
        const age = Math.max(0, step - Number(arc.lastScheduledStep || 0));
        const fairness = Math.min(0.15, age * 0.015);
        const base = Number(arc.opportunityScore || 0);
        return { arc, priority: base + fairness };
      })
      .filter((entry) => entry.priority >= 0.25 || entry.arc.id === preferredArcId)
      .sort((a, b) => b.priority - a.priority || a.arc.lastScheduledStep - b.arc.lastScheduledStep);

    let chosen = ranked[0]?.arc || this.arcByReference(preferredArcId) || this.activeArc() || this.arcs()[0] || null;
    if (!chosen) return null;
    chosen.lastScheduledStep = step;
    scheduler.decisions.push({
      step,
      fromArcId: scheduler.activeArcId || '',
      toArcId: chosen.id,
      priority: ranked.find((entry) => entry.arc.id === chosen.id)?.priority || Number(chosen.opportunityScore || 0)
    });
    scheduler.decisions = scheduler.decisions.slice(-300);
    scheduler.activeArcId = chosen.id;
    return chosen;
  }

  consume(parsed, observation) {
    this.explorer._schedulerObservation = observation;
    this.updateFitState(parsed);
    this.updateCandidateOpportunities(parsed);
    const evidenceArc = this.selectEvidenceArc(parsed);
    if (evidenceArc) this.mergeArcUpdate(evidenceArc, parsed, observation);
    const nextArc = this.chooseNextArc(evidenceArc?.id || this.activeArcId());
    this.syncStories();
    return { evidenceArc, nextArc };
  }

  syncStories() {
    const state = this.state();
    state.stories = this.arcs().map((arc) => ({
      id: arc.id,
      title: arc.title,
      nature: arc.concept || 'business-use-case arc',
      status: arc.status === 'broadly_complete' ? 'broadly_complete' : (arc.progress >= 30 ? 'building' : 'early'),
      progress: Number(arc.progress || 0),
      steps: arr(arc.evidence).map((item, index) => ({
        id: `${arc.id}-e${index + 1}`,
        artifactId: item.artifactId,
        meaning: item.meaning,
        relation: 'evidence',
        continuity: arc.lastFit?.continuity || 0,
        coherenceGain: arc.lastFit?.coherence || 0,
        placementConfidence: 1
      })),
      branches: [],
      dependencies: [],
      openQuestions: [],
      recentGain: Number(arc.opportunityScore || 0),
      evidence: arr(arc.evidence).map((item) => item.artifactId)
    }));
    this.explorer.activeStoryId = this.activeArcId();
  }
}
