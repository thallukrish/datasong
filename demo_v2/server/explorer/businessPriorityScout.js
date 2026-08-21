const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 520) => {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const clamp01 = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};
const PRIORITY_CLASSES = new Set([
  'core_end_user', 'revenue_critical', 'core_business', 'operational',
  'support', 'reporting', 'admin', 'configuration', 'technical'
]);

export const withBusinessPriorityScout = (Base) => class BusinessPriorityScoutExplorer extends Base {
  prioritySummary(arc) {
    return {
      itemId: `arc:${arc.id}`, kind: 'existing_workflow', arcId: arc.id,
      title: clean(arc.title, 180), actor: clean(arc.businessActor || arc.trigger, 140),
      intent: clean(arc.businessIntent, 220), outcome: clean(arc.outcome || arc.businessOutcome, 220),
      progress: Number(arc.progress || 0),
      mapState: arc.closureState === 'closed' ? 'complete' : (Number(arc.progress || 0) > 0 ? 'explored' : 'identified'),
      currentPriority: Number.isFinite(Number(arc.businessPriority)) ? Number(arc.businessPriority) : null,
      priorityModelVersion: arc.priorityModelVersion || ''
    };
  }

  legacyUnrankedWorkflows(limit = 8) {
    return this.pass1().arcs()
      .filter((arc) => arc?.id && arc.qualifiesAsBusinessUseCase !== false)
      .filter((arc) => !Number.isFinite(Number(arc.businessPriority)) || arc.priorityModelVersion !== 'business-priority-v1')
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  scoutPriorityBatch(candidates) { return arr(candidates).slice(0, 10); }

  candidatePrioritySummary(candidate) {
    const callPathId = arr(candidate?.callPathIds)[0] || '';
    const grouped = callPathId ? (this.rankedPathById?.(callPathId) || this.topology.topCallPaths?.(500)?.find((p) => p.id === callPathId)) : null;
    const compact = grouped ? this.compactCallPath(grouped) : null;
    return {
      itemId: `path:${candidate.id}`, kind: 'unseen_path_family', artifactId: candidate.id,
      callPathIds: arr(candidate.callPathIds), functionCount: Number(grouped?.functionCount || compact?.functionCount || 0),
      flow: compact?.flow || null, flowSequence: arr(compact?.flowSequence), terminal: compact?.terminal || null,
      sourcePaths: arr(grouped?.sourcePaths).slice(0, 3)
    };
  }

  scoutPriorityPrompt(candidates) {
    const legacy = this.legacyUnrankedWorkflows(8).map((arc) => this.prioritySummary(arc));
    const paths = this.scoutPriorityBatch(candidates).map((candidate) => this.candidatePrioritySummary(candidate));
    const covered = this.pass1().arcs()
      .filter((arc) => Number.isFinite(Number(arc.businessPriority)) && Number(arc.progress || 0) >= 80)
      .sort((a, b) => Number(b.businessPriority || 0) - Number(a.businessPriority || 0)).slice(0, 12)
      .map((arc) => ({ title: clean(arc.title, 160), priority: Number(arc.businessPriority || 0), progress: Number(arc.progress || 0) }));
    const contract = { summary: 'brief ranking rationale', rankings: [{
      itemId: 'exact supplied itemId', businessPriority: 0,
      priorityClass: 'core_end_user|revenue_critical|core_business|operational|support|reporting|admin|configuration|technical',
      businessUseCaseLikelihood: 0, novelty: 0, pursue: true,
      suggestedArcTitle: 'for unseen paths', businessActor: 'if evidenced', businessIntent: 'if evidenced', reason: 'short reason'
    }] };
    return [
      'MODE scout-business-priority-v1',
      `CURRENTLY_WELL_COVERED ${JSON.stringify(covered)}`,
      `ITEMS_TO_RANK ${JSON.stringify([...legacy, ...paths])}`,
      `RETURN ${JSON.stringify(contract)}`,
      'Rules:',
      '- Rank every supplied item by business importance, novelty, and expected semantic gain.',
      '- Prefer core end-user/customer journeys and revenue-critical flows, then core business, operational, support, reporting, admin/configuration, technical.',
      '- Existing workflows and new path families compete in one ranking; discovery age is irrelevant.',
      '- Avoid prioritizing variants of already well-covered workflows.',
      '- Low-priority business flows remain valid future work; ranking controls order only.',
      '- Mark clearly technical/framework paths pursue=false.',
      '- Use only supplied evidence and return compact valid JSON.'
    ].join('\n');
  }

  async callModel(dynamicPrompt, maxTokens) {
    if (String(dynamicPrompt || '').startsWith('MODE scout-business-priority-v1')) {
      return this.lightweightModelCall(
        `You are lemap's BUSINESS-PRIORITY SCOUT. Rank supplied existing workflows and unseen executable path families by business importance, novelty, and expected semantic gain. Do not invent behavior. Return strict JSON only.`,
        dynamicPrompt, 'SCOUT BUSINESS PRIORITY RERANKER'
      );
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  normalizePriorityResult(raw, candidates) {
    const pathIds = new Set(this.scoutPriorityBatch(candidates).map((c) => `path:${c.id}`));
    const arcIds = new Set(this.legacyUnrankedWorkflows(50).map((a) => `arc:${a.id}`));
    return arr(raw?.rankings)
      .filter((item) => pathIds.has(item?.itemId) || arcIds.has(item?.itemId))
      .map((item) => ({
        itemId: String(item.itemId), businessPriority: clamp01(item.businessPriority),
        priorityClass: PRIORITY_CLASSES.has(item.priorityClass) ? item.priorityClass : 'core_business',
        businessUseCaseLikelihood: clamp01(item.businessUseCaseLikelihood), novelty: clamp01(item.novelty),
        pursue: item.pursue !== false, suggestedArcTitle: clean(item.suggestedArcTitle, 180),
        businessActor: clean(item.businessActor, 180), businessIntent: clean(item.businessIntent, 260), reason: clean(item.reason, 320)
      }))
      .sort((a, b) => b.businessPriority - a.businessPriority || (b.novelty * b.businessUseCaseLikelihood) - (a.novelty * a.businessUseCaseLikelihood));
  }

  applyLegacyRankings(rankings) {
    for (const item of arr(rankings).filter((r) => r.itemId.startsWith('arc:'))) {
      const arc = this.pass1().arcByReference(item.itemId.slice(4));
      if (!arc) continue;
      arc.businessPriority = item.businessPriority;
      arc.priorityClass = item.priorityClass;
      arc.priorityReason = item.reason;
      arc.priorityModelVersion = 'business-priority-v1';
      arc.priorityRankedAt = new Date().toISOString();
    }
  }

  promotePriorityPaths(rankings, candidates) {
    const byArtifact = new Map(this.scoutPriorityBatch(candidates).map((candidate) => [candidate.id, candidate]));
    const existingTitles = new Set(this.pass1().arcs().map((arc) => String(arc.title || '').trim().toLowerCase()));
    const created = [];
    for (const item of arr(rankings).filter((r) => r.itemId.startsWith('path:'))) {
      if (!item.pursue || item.businessUseCaseLikelihood < 0.55 || item.novelty < 0.45 || created.length >= 3) continue;
      const candidate = byArtifact.get(item.itemId.slice(5));
      if (!candidate) continue;
      const title = item.suggestedArcTitle || clean(candidate.label || candidate.id, 180);
      if (!title || existingTitles.has(title.toLowerCase())) continue;
      const callPathId = arr(candidate.callPathIds)[0] || '';
      const grouped = callPathId ? (this.rankedPathById?.(callPathId) || this.topology.topCallPaths?.(500)?.find((p) => p.id === callPathId)) : null;
      if (!callPathId || !grouped) continue;
      const arc = this.pass1().createArc({
        title, concept: item.reason, businessActor: item.businessActor, businessIntent: item.businessIntent,
        confidence: Math.max(item.businessUseCaseLikelihood, item.novelty, item.businessPriority),
        qualifiesAsBusinessUseCase: true, qualification: 'business_use_case'
      }, { id: candidate.id, path: candidate.path || '' });
      if (!arc) continue;
      Object.assign(arc, {
        seedSource: 'scout_call_path', scoutArtifactId: candidate.id, scoutNovelty: item.novelty,
        callPathId, callPathVariantIds: arr(grouped.alternatives).map((alt) => alt.pathId),
        seedArtifactId: grouped.entrySymbolId || candidate.id, seedSourcePath: arr(grouped.sourcePaths)[0] || candidate.path || '',
        status: 'forming', progress: 0, businessPriority: item.businessPriority, priorityClass: item.priorityClass,
        priorityReason: item.reason, priorityModelVersion: 'business-priority-v1', priorityRankedAt: new Date().toISOString()
      });
      this.pass2().seed(arc.id);
      this.flowState(arc);
      existingTitles.add(title.toLowerCase());
      created.push({ arc, item, candidate });
    }
    return created;
  }

  markScoutBatchReviewed(candidates) {
    const scout = this.scout().ensureState();
    for (const candidate of this.scoutPriorityBatch(candidates)) {
      for (const id of arr(candidate.callPathIds)) if (!scout.reviewedCallPathIds.includes(id)) scout.reviewedCallPathIds.push(id);
    }
  }

  unfinishedWholeFlowArcs(excludeArcId = '') {
    return this.pass1().arcs()
      .filter((arc) => arc?.id && arc.id !== excludeArcId && !this.flowState(arc)?.completed)
      .sort((a, b) => {
        const ap = Number.isFinite(Number(a.businessPriority)) ? Number(a.businessPriority) : -1;
        const bp = Number.isFinite(Number(b.businessPriority)) ? Number(b.businessPriority) : -1;
        if (ap !== bp) return bp - ap;
        const as = this.flowState(a)?.started ? 1 : 0;
        const bs = this.flowState(b)?.started ? 1 : 0;
        if (as !== bs) return as - bs;
        return Number(b.opportunityScore || 0) - Number(a.opportunityScore || 0) || Number(a.createdStep || 0) - Number(b.createdStep || 0);
      });
  }

  async runScout(candidates) {
    const before = this.snapshot();
    const batch = this.scoutPriorityBatch(candidates);
    const observation = { id: `scout-priority:${this.state.step}`, path: 'business-priority scout', kind: 'scout_review', canonical: { phase: 'scout', policy: 'business_priority_rerank' } };
    const dynamicPrompt = this.scoutPriorityPrompt(candidates);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${dynamicPrompt}\nRETRY: return complete valid JSON only.` : dynamicPrompt;
      const result = await this.callAndRecordAttempt({ dynamicPrompt: prompt, observation, candidates: batch, before, maxTokens: undefined, retry });
      try {
        const raw = JSON.parse(result.raw);
        const rankings = this.normalizePriorityResult(raw, candidates);
        this.applyLegacyRankings(rankings);
        this.markScoutBatchReviewed(candidates);
        const created = this.promotePriorityPaths(rankings, candidates);
        const next = this.unfinishedWholeFlowArcs('')[0] || null;
        if (next) {
          const scheduler = this.pass1().ensureState();
          scheduler.activeArcId = next.id;
          next.lastScheduledStep = Number(this.state.step || 0);
        }
        const scout = this.scout().ensureState();
        scout.runs.push({
          step: this.state.step, reason: scout.pendingReason, candidateCount: batch.length,
          candidateWindow: Number(scout.candidateWindow || 0), reviewedCallPathCount: scout.reviewedCallPathIds.length,
          rankedExistingWorkflowCount: rankings.filter((r) => r.itemId.startsWith('arc:')).length,
          createdArcIds: created.map((c) => c.arc.id), chosenArcId: next?.id || '', summary: clean(raw?.summary, 400)
        });
        scout.runs = scout.runs.slice(-120);
        scout.lastFingerprint = this.scout().fingerprint(candidates);
        scout.pendingReason = '';
        this.pass1().syncStories();
        this.syncAllSemanticObjects();
        this.persistSemanticMap?.();
        await this.appendRunLog({
          type: 'scout_business_priority_applied', call: result.callNumber, explorationStep: this.state.step,
          retry, timestamp: new Date().toISOString(), rankings, createdArcIds: created.map((c) => c.arc.id), chosenArcId: next?.id || ''
        });
        this.printCallSummary(result.usage, result.callNumber, next ? `Scout ranked priorities; next ${next.title}` : 'Scout ranked batch');
        return next ? { arc: next, rankings, created } : null;
      } catch (error) {
        lastError = error;
        await this.appendRunLog({
          type: 'llm_invalid_scout_business_priority', call: result.callNumber, explorationStep: this.state.step,
          retry, timestamp: new Date().toISOString(), error: error.message, rawResponse: result.raw,
          usage: result.usage, cumulativeUsage: { ...this.state.tokenUsage }
        });
      }
    }
    throw new Error(`No valid Scout business-priority response after retry: ${lastError?.message || 'unknown error'}`);
  }
};
