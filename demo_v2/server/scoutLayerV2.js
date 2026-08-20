import { ScoutLayer } from './scoutLayer.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
function text(value, max = 320) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export class ScoutLayerV2 extends ScoutLayer {
  ensureState() {
    const scout = super.ensureState();
    if (!Array.isArray(scout.reviewedCallPathIds)) scout.reviewedCallPathIds = [];
    if (!Number.isFinite(Number(scout.candidateWindow))) scout.candidateWindow = 60;
    return scout;
  }

  representedCallPathIds() {
    const ids = new Set();
    for (const arc of this.explorer.pass1().arcs()) {
      if (arc.callPathId) ids.add(arc.callPathId);
      for (const id of arr(arc.callPathVariantIds)) ids.add(id);
      for (const id of arr(arc.containedCallPathIds)) ids.add(id);
      for (const id of arr(arc.relatedCallPathIds)) ids.add(id);
    }
    for (const id of arr(this.ensureState().reviewedCallPathIds)) ids.add(id);
    return ids;
  }

  broadCandidates() {
    const scout = this.ensureState();
    const represented = this.representedCallPathIds();
    if (typeof this.explorer.topology?.callPathScoutCandidates !== 'function') return [];

    // Scout must exhaust the ranked call-path population, not a fixed top-N
    // window. Grow the window until unseen entrances appear or the ranked index
    // has genuinely been covered.
    const rankedCount = Number(this.explorer.topology?.callPathIndex?.rankedPathCount || 0);
    const hardCap = Math.max(60, Math.min(2500, rankedCount || 600));
    let window = Math.max(60, Number(scout.candidateWindow || 60));

    while (true) {
      const pathSeeds = this.explorer.topology.callPathScoutCandidates(window);
      const unseen = arr(pathSeeds)
        .map((candidate) => ({
          ...candidate,
          callPathIds: arr(candidate.callPathIds).filter((id) => !represented.has(id))
        }))
        .filter((candidate) => candidate.callPathIds.length > 0);

      if (unseen.length) {
        scout.candidateWindow = window;
        return unseen.slice(0, 12);
      }

      if (window >= hardCap) {
        scout.candidateWindow = hardCap;
        return [];
      }

      const next = Math.min(hardCap, Math.max(window + 60, window * 2));
      if (next === window) return [];
      window = next;
    }
  }

  fingerprint(candidates) {
    const arcs = this.explorer.pass1().arcBoard().map((a) => `${a.id}:${a.title}:${a.progress}`).sort();
    const ids = arr(candidates).flatMap((candidate) => arr(candidate.callPathIds)).sort();
    return JSON.stringify({ arcs, ids });
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

    // Every supplied path is considered reviewed in this Scout turn. The next
    // invocation therefore advances to lower-ranked unseen call-path entrances.
    for (const candidate of arr(candidates)) {
      for (const id of arr(candidate.callPathIds)) {
        if (!scout.reviewedCallPathIds.includes(id)) scout.reviewedCallPathIds.push(id);
      }
    }

    const created = [];
    for (const direction of directions) {
      if (direction.novelty < 0.5 || direction.businessUseCaseLikelihood < 0.55) continue;
      const candidate = direction.candidate;
      const callPathId = arr(candidate.callPathIds)[0] || '';
      const grouped = callPathId
        ? (this.explorer.rankedPathById?.(callPathId) || this.explorer.topology.topCallPaths?.(500)?.find((p) => p.id === callPathId))
        : null;
      const arc = this.explorer.pass1().createArc({
        title: text(direction.suggestedArcTitle, 180),
        concept: text(direction.reason, 300),
        businessActor: text(direction.businessActor, 220),
        businessIntent: text(direction.businessIntent, 280),
        confidence: Math.max(direction.businessUseCaseLikelihood, direction.novelty),
        qualifiesAsBusinessUseCase: true,
        qualification: 'business_use_case'
      }, { id: candidate.id, path: candidate.path || '' });
      if (!arc) continue;
      arc.seedSource = 'scout_call_path';
      arc.scoutArtifactId = candidate.id;
      arc.callPathId = callPathId;
      arc.callPathVariantIds = arr(grouped?.alternatives).map((alt) => alt.pathId);
      arc.seedArtifactId = grouped?.entrySymbolId || candidate.id;
      arc.seedSourcePath = arr(grouped?.sourcePaths)[0] || candidate.path || '';
      created.push({ arc, direction, candidate });
    }

    const chosen = created[0] || null;
    if (chosen) {
      const scheduler = this.explorer.pass1().ensureState();
      scheduler.activeArcId = chosen.arc.id;
      chosen.arc.lastScheduledStep = Number(this.state().step || 0);
      this.explorer.pass1().syncStories();
    }

    scout.runs.push({
      step: this.state().step,
      reason: scout.pendingReason,
      candidateCount: arr(candidates).length,
      candidateWindow: Number(scout.candidateWindow || 0),
      reviewedCallPathCount: scout.reviewedCallPathIds.length,
      newDirectionCount: created.length,
      chosenArcId: chosen?.arc?.id || '',
      chosenArtifactId: chosen?.direction?.artifactId || '',
      summary: text(parsed?.summary, 400)
    });
    scout.runs = scout.runs.slice(-120);
    scout.lastFingerprint = this.fingerprint(candidates);
    scout.pendingReason = '';
    return chosen;
  }
}
