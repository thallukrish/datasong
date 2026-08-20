import { ProgressiveRepositoryExplorerV33 } from './progressiveRepositoryExplorerV33.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
function text(value, max = 320) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const PRIORITY_CLASSES = new Set([
  'core_end_user', 'revenue_critical', 'core_business', 'operational',
  'support', 'reporting', 'admin', 'configuration', 'technical'
]);

const STATIC_CONTRACT_V4 = {
  summary: 'brief assessment of the supplied executable flow candidates',
  paths: [{
    pathId: 'exact supplied pathId',
    classification: 'business_flow|technical|uncertain',
    confidence: 0,
    flowTitle: 'title for the coherent flow segment only',
    businessActor: 'if evidenced',
    businessIntent: 'if evidenced',
    completionCondition: 'if evidenced',
    businessOutcome: 'if evidenced',
    businessPriority: 0,
    priorityClass: 'core_end_user|revenue_critical|core_business|operational|support|reporting|admin|configuration|technical',
    priorityReason: 'short reason for business importance',
    semanticBoundaryAt: 'optional compact flow token where another concern begins',
    coherentThroughSignature: 'last compact flow token belonging to this flow',
    reason: 'short evidence-based reason'
  }]
};

const STATIC_RULES_V4 = `Rules:
- Use only the supplied compact normalized executable structure and terminal boundary.
- External calls terminate the known repository path; never imagine their implementation.
- transition/service/entity/navigate tokens describe executable business structure; navigate may mark a semantic boundary.
- If behavior after a navigation serves a different actor goal, describe only the coherent prefix before the new concern.
- For business_flow paths, coherentThroughSignature must be one exact compact token appearing in flowSequence, flow.prefix, flow.branches, or flow.suffix.
- Rank business flows by business importance: core customer/end-user and revenue-critical journeys first, then core business/operational, support/reporting, admin/configuration; technical stays lowest.
- businessPriority controls exploration order, not whether a valid low-priority business flow eventually gets explored.
- Do NOT compare paths for containment or infer parent/subflow relationships. DataSong handles structural grouping and containment deterministically.
- Mark technical/framework-only paths technical.
- Classify every supplied path and keep reasons short.`;

export class ProgressiveRepositoryExplorerV34 extends ProgressiveRepositoryExplorerV33 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'parallel-callpath-compact-normalized-classifier-v14';
    return state;
  }

  compactCallPath(path) {
    const merged = path?.mergedStructure;
    const terminal = path?.terminal?.type === 'external'
      ? { type: 'external', calls: arr(path.terminal.calls).map((call) => String(call.name || '')).filter(Boolean) }
      : path?.terminal?.type === 'cycle'
        ? { type: 'cycle' }
        : { type: 'end' };

    const base = {
      pathId: path.id,
      functionCount: Number(path.functionCount || 0),
      variants: Number(path.branchVariantCount || 1)
        + Number(path.alternateEntranceCount || 0)
        + Number(path.duplicateVariantCount || 0),
      alternateEntranceCount: Number(path.alternateEntranceCount || 0),
      terminal
    };

    if (merged) {
      return {
        ...base,
        flow: {
          prefix: arr(merged.commonPrefix),
          branches: arr(merged.branches),
          suffix: arr(merged.commonSuffix)
        }
      };
    }

    return { ...base, flowSequence: arr(path.normalizedFlowTokens) };
  }

  callPathPrompt() {
    const paths = this.topology.topCallPaths(10).map((path) => this.compactCallPath(path));
    return [
      'MODE call-path-business-seed-classification-v4',
      `RETURN_CONTRACT ${JSON.stringify(STATIC_CONTRACT_V4)}`,
      STATIC_RULES_V4,
      `DYNAMIC_EXECUTABLE_FLOW_CANDIDATES ${JSON.stringify(paths)}`
    ].join('\n');
  }

  clippedSignatures(path, item) {
    const tokens = arr(path?.normalizedFlowTokens);
    if (!tokens.length) return [];
    const through = String(item?.coherentThroughSignature || '').trim();
    if (!through) return tokens;
    const index = tokens.findIndex((token) => token === through);
    return index >= 0 ? tokens.slice(0, index + 1) : tokens;
  }

  async callModel(dynamicPrompt, maxTokens) {
    if (String(dynamicPrompt || '').startsWith('MODE call-path-business-seed-classification-v4')) {
      return this.lightweightModelCall(
        `You are DataSong's CALL-PATH BUSINESS-FLOW SEED CLASSIFIER.\nYou receive compact deterministic normalized executable flow structures from the supplied repository boundary.\nDo not reconstruct omitted source/XML details and do not infer implementations for external calls.\nFor each supplied candidate classify its coherent business flow and assign a business-priority score. Prefer core customer/end-user and revenue-critical journeys over admin/reporting/configuration flows.\nReturn strict compact JSON only.`,
        dynamicPrompt,
        'CALL-PATH BUSINESS-FLOW SEED CLASSIFIER V4'
      );
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  normalizeCallPathClassification(raw) {
    const parsed = super.normalizeCallPathClassification(raw);
    const byId = new Map(arr(raw?.paths).map((item) => [item?.pathId, item]));
    parsed.paths = arr(parsed.paths).map((item) => {
      const source = byId.get(item.pathId) || {};
      return {
        ...item,
        businessPriority: clamp01(source.businessPriority),
        priorityClass: PRIORITY_CLASSES.has(source.priorityClass) ? source.priorityClass : (item.classification === 'technical' ? 'technical' : 'core_business'),
        priorityReason: text(source.priorityReason, 300)
      };
    });
    return parsed;
  }

  async getSemanticUpdate(args) {
    if (!String(args.dynamicPrompt || '').startsWith('MODE call-path-business-seed-classification-v4')) {
      return super.getSemanticUpdate(args);
    }

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${args.dynamicPrompt}\nRETRY: return complete valid JSON only.` : args.dynamicPrompt;
      const result = await this.callAndRecordAttempt({
        dynamicPrompt: prompt,
        observation: args.observation,
        candidates: [],
        before: args.before,
        maxTokens: undefined,
        retry
      });
      try {
        return { ...result, parsed: this.normalizeCallPathClassification(JSON.parse(result.raw)) };
      } catch (error) {
        lastError = error;
        await this.appendRunLog({
          type: 'llm_invalid_call_path_classification', call: result.callNumber,
          explorationStep: this.state.step, retry, timestamp: new Date().toISOString(),
          error: error.message, rawResponse: result.raw, usage: result.usage,
          cumulativeUsage: { ...this.state.tokenUsage }
        });
        this.printCallSummary(result.usage, result.callNumber, `rejected/${error.message}`);
      }
    }
    throw new Error(`No valid call-path classification after retry: ${lastError?.message || 'unknown error'}`);
  }

  applyDelta(parsed, observation) {
    const result = super.applyDelta(parsed, observation);
    if (!parsed?._callPathPreprocess) return result;

    const priorityByPath = new Map(arr(parsed.paths).map((item) => [item.pathId, item]));
    for (const arc of this.pass1().arcs()) {
      const item = priorityByPath.get(arc.callPathId);
      if (!item) continue;
      arc.businessPriority = Number(item.businessPriority || 0);
      arc.priorityClass = item.priorityClass || 'core_business';
      arc.priorityReason = item.priorityReason || '';
      arc.priorityModelVersion = 'business-priority-v1';
      arc.priorityRankedAt = new Date().toISOString();
      // The existing Pass-1 scheduler uses opportunityScore. Seed it with the
      // business-priority score so the initial top-10 flows are scheduled in
      // business order without another model call.
      arc.opportunityScore = Math.max(Number(arc.opportunityScore || 0), Number(arc.businessPriority || 0));
    }

    const cp = this.state.callPathPreprocess;
    const arcs = this.pass1().arcs();
    const seededIds = new Set(arr(cp?.seededArcIds));
    cp.seededArcs = arcs
      .filter((arc) => seededIds.has(arc.id) || arc.seedSource === 'call_path_preprocessor')
      .map((arc) => ({
        arcId: arc.id,
        title: arc.title || '',
        actor: arc.businessActor || arc.trigger || '',
        intent: arc.businessIntent || '',
        confidence: Number(arc.confidence || arc.opportunityScore || 0),
        businessPriority: Number(arc.businessPriority || 0),
        priorityClass: arc.priorityClass || '',
        callPathId: arc.callPathId || '',
        coherentFunctionCount: Number(arc.coherentFunctionCount || 0),
        containedCallPathIds: arr(arc.containedCallPathIds),
        status: arc.status || 'seeded'
      }));

    const top = typeof this.topology?.topCallPaths === 'function' ? this.topology.topCallPaths(10) : [];
    cp.topologySummary = {
      topCandidateCount: top.length,
      groupedVariantCount: top.reduce((sum, path) => sum + Number(path.branchVariantCount || 1), 0),
      alternateEntranceCount: top.reduce((sum, path) => sum + Number(path.alternateEntranceCount || 0), 0),
      classifierInput: 'compact_normalized_flow_structure',
      rankingPolicy: 'business_priority_v1',
      rerunPolicy: 'one_shot_per_repository_prepare'
    };
    return result;
  }
}
