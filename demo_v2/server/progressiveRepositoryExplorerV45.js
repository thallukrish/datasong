import { ProgressiveRepositoryExplorerV44 } from './progressiveRepositoryExplorerV44.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
function text(value, max = 320) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export class ProgressiveRepositoryExplorerV45 extends ProgressiveRepositoryExplorerV44 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'callgraph-whole-flow-scout-direct-pass1-v25';
    return state;
  }

  promoteScoutDirections(parsed, candidates) {
    const scout = this.scout().ensureState();
    const byId = new Map(arr(candidates).map((candidate) => [candidate.id, candidate]));
    const existingTitles = new Set(this.pass1().arcs().map((arc) => String(arc.title || '').trim().toLowerCase()));

    // A Scout batch is consumed exactly once regardless of whether it yields an arc.
    for (const candidate of arr(candidates)) {
      for (const id of arr(candidate.callPathIds)) {
        if (!scout.reviewedCallPathIds.includes(id)) scout.reviewedCallPathIds.push(id);
      }
    }

    const ranked = arr(parsed?.newDirections)
      .filter((item) => byId.has(item?.artifactId) && item?.novel !== false && item?.pursue !== false)
      .map((item) => ({
        ...item,
        novelty: clamp01(item?.novelty),
        businessUseCaseLikelihood: clamp01(item?.businessUseCaseLikelihood),
        candidate: byId.get(item.artifactId)
      }))
      .filter((item) => item.novelty >= 0.55 && item.businessUseCaseLikelihood >= 0.55)
      .sort((a, b) => (b.novelty * b.businessUseCaseLikelihood) - (a.novelty * a.businessUseCaseLikelihood));

    const created = [];
    // Keep Scout selective: at most three genuinely different new threads from one batch.
    for (const direction of ranked) {
      if (created.length >= 3) break;
      const title = text(direction.suggestedArcTitle, 180);
      if (!title || existingTitles.has(title.toLowerCase())) continue;

      const candidate = direction.candidate;
      const callPathId = arr(candidate?.callPathIds)[0] || '';
      if (!callPathId) continue;
      const grouped = this.rankedPathById?.(callPathId)
        || this.topology.topCallPaths?.(250)?.find((path) => path.id === callPathId)
        || null;
      if (!grouped) continue;

      const arc = this.pass1().createArc({
        title,
        concept: text(direction.reason, 300),
        businessActor: text(direction.businessActor, 220),
        businessIntent: text(direction.businessIntent, 280),
        confidence: Math.max(direction.novelty, direction.businessUseCaseLikelihood),
        qualifiesAsBusinessUseCase: true,
        qualification: 'business_use_case'
      }, { id: candidate.id, path: candidate.path || '' });
      if (!arc) continue;

      arc.seedSource = 'scout_call_path';
      arc.scoutArtifactId = candidate.id;
      arc.scoutNovelty = direction.novelty;
      arc.callPathId = callPathId;
      arc.callPathVariantIds = arr(grouped.alternatives).map((alt) => alt.pathId);
      arc.seedArtifactId = grouped.entrySymbolId || candidate.id;
      arc.seedSourcePath = arr(grouped.sourcePaths)[0] || candidate.path || '';
      arc.status = 'forming';
      arc.progress = 0;
      this.pass2().seed(arc.id);
      this.flowState(arc); // ensure whole-flow state exists before scheduling
      existingTitles.add(title.toLowerCase());
      created.push({ arc, direction, candidate });
    }

    const chosen = created[0] || null;
    if (chosen) {
      const scheduler = this.pass1().ensureState();
      scheduler.activeArcId = chosen.arc.id;
      chosen.arc.lastScheduledStep = Number(this.state.step || 0);
      this.pass1().syncStories();
    }

    scout.runs.push({
      step: this.state.step,
      reason: scout.pendingReason,
      candidateCount: arr(candidates).length,
      newDirectionCount: created.length,
      chosenArcId: chosen?.arc?.id || '',
      createdArcIds: created.map((item) => item.arc.id),
      chosenArtifactId: chosen?.direction?.artifactId || '',
      summary: text(parsed?.summary, 400)
    });
    scout.runs = scout.runs.slice(-120);
    scout.lastFingerprint = this.scout().fingerprint(candidates);
    scout.pendingReason = '';
    return { chosen, created };
  }

  async runScout(candidates) {
    const before = this.snapshot();
    const observation = {
      id: `scout:${this.state.step}`,
      path: 'compressed call-path novelty scout',
      kind: 'scout_review',
      canonical: { phase: 'scout', policy: 'direct_pass1_promotion' }
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
        const promoted = this.promoteScoutDirections(parsed, candidates);
        await this.appendRunLog({
          type: 'scout_direct_pass1_applied',
          call: result.callNumber,
          explorationStep: this.state.step,
          retry,
          timestamp: new Date().toISOString(),
          trigger: before.scout?.pendingReason || '',
          parsedResponse: parsed,
          createdArcIds: promoted.created.map((item) => item.arc.id),
          chosenArcId: promoted.chosen?.arc?.id || '',
          chosenArtifactId: promoted.chosen?.direction?.artifactId || ''
        });
        this.printCallSummary(result.usage, result.callNumber,
          promoted.chosen ? `Scout admitted ${promoted.created.length} new Pass-1 thread${promoted.created.length === 1 ? '' : 's'}` : 'Scout found no admissible new thread');
        return promoted.chosen || null;
      } catch (error) {
        lastError = error;
        await this.appendRunLog({
          type: 'llm_invalid_scout_direct_pass1',
          call: result.callNumber,
          explorationStep: this.state.step,
          retry,
          timestamp: new Date().toISOString(),
          error: error.message,
          rawResponse: result.raw,
          usage: result.usage,
          cumulativeUsage: { ...this.state.tokenUsage }
        });
        this.printCallSummary(result.usage, result.callNumber, `rejected/${error.message}`);
      }
    }
    throw new Error(`No valid direct Scout response after retry: ${lastError?.message || 'unknown error'}`);
  }
}
