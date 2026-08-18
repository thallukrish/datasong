function arr(value) { return Array.isArray(value) ? value : []; }
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
function text(value, max = 320) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export class ScoutLayer {
  constructor(explorer) { this.explorer = explorer; }
  state() { return this.explorer.state; }

  ensureState() {
    const state = this.state();
    if (!state.scout) {
      state.scout = {
        runs: [],
        signalByArc: {},
        lastFingerprint: '',
        pendingReason: '',
        discoveredStartIds: []
      };
    }
    if (!state.scout.signalByArc) state.scout.signalByArc = {};
    if (!Array.isArray(state.scout.runs)) state.scout.runs = [];
    if (!Array.isArray(state.scout.discoveredStartIds)) state.scout.discoveredStartIds = [];
    return state.scout;
  }

  notePass2Signal(parsed) {
    const scout = this.ensureState();
    const arc = this.explorer.pass1().activeArc();
    if (!arc || !parsed?._pass12) return '';

    const fit = arr(parsed.arcFits).find((item) => item?.arcId === arc.id);
    const score = fit ? this.explorer.pass1().scoreFit(fit) : 0;
    if (!scout.signalByArc[arc.id]) scout.signalByArc[arc.id] = [];
    const trail = scout.signalByArc[arc.id];
    trail.push({
      step: this.state().step,
      score,
      classification: String(parsed.evidenceClassification || ''),
      candidateCount: arr(parsed.candidateScores).filter((item) => item?.arcId === arc.id && this.explorer.pass1().scoreFit(item) >= 0.25).length,
      progress: Number(arc.progress || 0)
    });
    scout.signalByArc[arc.id] = trail.slice(-12);

    const recent = scout.signalByArc[arc.id].slice(-3);
    const declining = recent.length === 3
      && recent[0].score > recent[1].score
      && recent[1].score > recent[2].score
      && (recent[0].score - recent[2].score) >= 0.10;
    const weak = score < 0.25;
    const locallyExhausted = trail.at(-1)?.candidateCount === 0;
    const technicalDrift = ['technical', 'orientation'].includes(String(parsed.evidenceClassification || '')) && score < 0.45;
    const complete = arc.status === 'broadly_complete';

    let reason = '';
    if (complete) reason = `arc ${arc.id} reached a broad completion milestone`;
    else if (declining) reason = `semantic signal for ${arc.id} is declining`;
    else if (weak) reason = `semantic fit for ${arc.id} fell below admissibility`;
    else if (locallyExhausted) reason = `local admissible candidates for ${arc.id} are exhausted`;
    else if (technicalDrift) reason = `current evidence for ${arc.id} is technical/orientation with weak business fit`;

    if (reason) scout.pendingReason = reason;
    return reason;
  }

  broadCandidates() {
    const currentId = String(this.explorer._currentObservationId || this.state().currentArtifact?.id || '');
    const currentSource = typeof this.explorer.sourcePathForArtifactId === 'function'
      ? this.explorer.sourcePathForArtifactId(currentId)
      : '';
    return arr(this.state().frontier)
      .filter((candidate) => candidate?.id && !this.state().visited.includes(candidate.id))
      .filter((candidate) => {
        const id = String(candidate.id || '');
        return id.startsWith('dir:') || id.startsWith('file:');
      })
      .filter((candidate) => {
        if (!currentSource || typeof this.explorer.sourcePathForArtifactId !== 'function') return true;
        return this.explorer.sourcePathForArtifactId(candidate.id) !== currentSource;
      })
      .sort((a, b) => this.explorer.candidatePriority(b) - this.explorer.candidatePriority(a));
  }

  exploredSummary() {
    const seen = new Set();
    const result = [];
    for (const id of arr(this.state().visited)) {
      let source = '';
      if (typeof this.explorer.sourcePathForArtifactId === 'function') source = this.explorer.sourcePathForArtifactId(id);
      const value = source || String(id || '');
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
    return result.slice(-40);
  }

  fingerprint(candidates) {
    const arcs = this.explorer.pass1().arcBoard().map((a) => `${a.id}:${a.title}:${a.progress}`).sort();
    const starts = this.explorer.discovery().board().map((s) => `${s.id}:${s.title}:${s.status}:${s.confidence}`).sort();
    const ids = arr(candidates).map((c) => c.id).sort();
    return JSON.stringify({ arcs, starts, ids });
  }

  shouldRun(candidates) {
    const scout = this.ensureState();
    if (!scout.pendingReason) return false;
    if (!arr(candidates).length) return false;
    const fp = this.fingerprint(candidates);
    return fp !== scout.lastFingerprint;
  }

  consumeScoutResult(parsed, candidates) {
    const scout = this.ensureState();
    const byId = new Map(arr(candidates).map((candidate) => [candidate.id, candidate]));
    const directions = arr(parsed?.newDirections)
      .filter((item) => byId.has(item?.artifactId) && item?.novel !== false && item?.pursue !== false)
      .map((item) => ({
        ...item,
        businessUseCaseLikelihood: clamp01(item.businessUseCaseLikelihood),
        novelty: clamp01(item.novelty),
        candidate: byId.get(item.artifactId)
      }))
      .sort((a, b) => (b.novelty * b.businessUseCaseLikelihood) - (a.novelty * a.businessUseCaseLikelihood));

    const created = [];
    for (const direction of directions) {
      const start = this.explorer.discovery().createStart({
        artifactId: direction.artifactId,
        suggestedArcTitle: text(direction.suggestedArcTitle, 180),
        businessUseCaseLikelihood: direction.businessUseCaseLikelihood,
        businessActor: text(direction.businessActor, 220),
        businessIntent: text(direction.businessIntent, 280),
        reason: text(direction.reason, 300),
        qualifiesAsBusinessUseCase: false
      });
      if (!start) continue;
      start.scoutSeeded = true;
      start.scoutSeedStep = this.state().step;
      if (!scout.discoveredStartIds.includes(start.id)) scout.discoveredStartIds.push(start.id);
      created.push({ start, direction });
    }

    const chosen = created[0] || null;
    if (chosen) {
      const discovery = this.explorer.discovery().ensureState();
      discovery.status = 'active';
      discovery.activeStartId = chosen.start.id;
    }

    scout.runs.push({
      step: this.state().step,
      reason: scout.pendingReason,
      candidateCount: arr(candidates).length,
      newDirectionCount: created.length,
      chosenStartId: chosen?.start?.id || '',
      chosenArtifactId: chosen?.direction?.artifactId || '',
      summary: text(parsed?.summary, 400)
    });
    scout.runs = scout.runs.slice(-120);
    scout.lastFingerprint = this.fingerprint(candidates);
    scout.pendingReason = '';
    return chosen;
  }
}
