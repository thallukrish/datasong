import { ProgressiveRepositoryExplorerV27 } from './progressiveRepositoryExplorerV27.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 360) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const CALL_PATH_SYSTEM = `You are DataSong's CALL-PATH BUSINESS-FLOW SEED CLASSIFIER.
You receive only deterministic reconstructed executable-path signatures from the supplied repository boundary.
Do not reconstruct source code and do not assume implementations for external calls.
Classify each supplied grouped path as business_flow, technical, subflow, or uncertain.
A business_flow should represent a recognizable actor/business goal or operational outcome. A subflow is meaningful business behavior that is more naturally part of a broader flow. Technical paths are framework/configuration/plumbing.
A grouped path may contain alternate branch variants of the same structural flow; classify the group once.
Edge labels matter: CALL/NEXT/TRIGGER usually continue execution, while NAVIGATE crosses a screen/navigation boundary and may introduce a new semantic concern. Do not automatically treat behavior after NAVIGATE as part of the same business goal.
Return strict compact JSON only.`;

export class ProgressiveRepositoryExplorerV29 extends ProgressiveRepositoryExplorerV27 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'parallel-callpath-discovery-pass1-pass2-v9';
    state.callPathPreprocess = {
      status: 'pending',
      reviewedPathIds: [],
      classifications: [],
      seededArcIds: []
    };
    return state;
  }

  concreteQualification(item) {
    return item?.isConcreteBusinessUseCase === true
      && !!text(item?.businessActor, 220)
      && !!text(item?.businessIntent, 280)
      && !!text(item?.completionCondition, 300)
      && !!text(item?.businessOutcome, 320);
  }

  callPathPending() {
    return this.state?.callPathPreprocess?.status === 'pending'
      && typeof this.topology?.topCallPaths === 'function'
      && this.topology.topCallPaths(10).length > 0;
  }

  callPathPrompt() {
    const paths = this.topology.topCallPaths(10).map((path) => ({
      pathId: path.id,
      functionCount: path.functionCount,
      branchVariantCount: Number(path.branchVariantCount || 1),
      signatures: arr(path.signatures),
      edgeRelations: arr(path.relations),
      rendered: path.rendered,
      alternatives: arr(path.alternatives).slice(0, 5).map((alt) => ({
        pathId: alt.pathId,
        functionCount: alt.functionCount,
        signatures: arr(alt.signatures),
        edgeRelations: arr(alt.relations),
        terminal: alt.terminal?.type || 'end'
      })),
      terminal: path.terminal?.type === 'external'
        ? { type: 'external', calls: arr(path.terminal.calls).map((call) => ({ relation: call.relation, name: call.name })) }
        : path.terminal?.type === 'cycle'
          ? { type: 'cycle' }
          : { type: 'end' }
    }));
    const contract = {
      summary: 'brief assessment of the supplied longest grouped executable paths',
      paths: [{
        pathId: 'exact supplied pathId',
        classification: 'business_flow|technical|subflow|uncertain',
        confidence: 0,
        flowTitle: 'one title for this grouped structural flow',
        businessActor: 'if evidenced',
        businessIntent: 'if evidenced',
        completionCondition: 'if evidenced',
        businessOutcome: 'if evidenced',
        semanticBoundaryAt: 'optional signature or NAVIGATE edge where a different concern begins',
        reason: 'short evidence-based reason'
      }]
    };
    return `MODE call-path-business-seed-classification\nLONGEST_EXECUTABLE_PATHS ${JSON.stringify(paths)}\nRETURN ${JSON.stringify(contract)}\nRules:\n- Use only supplied signatures/order/edge labels/terminal boundary.\n- Longer paths are surfaced first as a simple structural heuristic, not as proof of business meaning.\n- Alternate branch variants have already been grouped deterministically; classify the group once rather than treating each variant as a separate flow.\n- External calls terminate the known repository path; do not imagine their implementation.\n- CALL/NEXT/TRIGGER edges normally preserve execution continuity. NAVIGATE is a weaker semantic-continuity edge: explicitly consider whether the business goal ends before or at that boundary.\n- If a path crosses via NAVIGATE into behavior serving a different actor goal, identify semanticBoundaryAt and classify only the coherent business portion.\n- Mark a path business_flow only when actor/intent/completion/outcome are reasonably evidenced by the coherent portion.\n- Mark reusable business behavior that belongs inside a larger journey as subflow.\n- Technical/framework/navigation-only paths are technical.\n- Classify every supplied grouped path and keep reasons short.`;
  }

  buildPrompt(observation, candidates) {
    if (this.callPathPending()) return this.callPathPrompt();
    return super.buildPrompt(observation, candidates);
  }

  async callModel(dynamicPrompt, maxTokens) {
    if (String(dynamicPrompt || '').startsWith('MODE call-path-business-seed-classification')) {
      return this.lightweightModelCall(CALL_PATH_SYSTEM, dynamicPrompt, 'CALL-PATH BUSINESS-FLOW SEED CLASSIFIER');
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  normalizeCallPathClassification(raw) {
    const known = new Set(this.topology.topCallPaths(10).map((path) => path.id));
    const allowed = new Set(['business_flow', 'technical', 'subflow', 'uncertain']);
    return {
      _callPathPreprocess: true,
      summary: text(raw?.summary, 400),
      paths: arr(raw?.paths)
        .filter((item) => known.has(item?.pathId))
        .map((item) => ({
          pathId: item.pathId,
          classification: allowed.has(item?.classification) ? item.classification : 'uncertain',
          confidence: clamp01(item?.confidence),
          flowTitle: text(item?.flowTitle, 180),
          businessActor: text(item?.businessActor, 220),
          businessIntent: text(item?.businessIntent, 280),
          completionCondition: text(item?.completionCondition, 300),
          businessOutcome: text(item?.businessOutcome, 320),
          semanticBoundaryAt: text(item?.semanticBoundaryAt, 300),
          reason: text(item?.reason, 300)
        })),
      next: { type: 'advance' }
    };
  }

  async getSemanticUpdate(args) {
    if (!String(args.dynamicPrompt || '').startsWith('MODE call-path-business-seed-classification')) {
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
    if (!parsed?._callPathPreprocess) return super.applyDelta(parsed, observation);

    const state = this.state.callPathPreprocess;
    const byPath = new Map(this.topology.topCallPaths(10).map((path) => [path.id, path]));
    const existingTitles = new Map(this.pass1().arcs().map((arc) => [String(arc.title || '').trim().toLowerCase(), arc]));
    const seeded = [];

    state.classifications = parsed.paths;
    state.reviewedPathIds = parsed.paths.map((item) => item.pathId);

    for (const item of parsed.paths) {
      if (item.classification !== 'business_flow' || item.confidence < 0.55) continue;
      if (!item.flowTitle || !item.businessActor || !item.businessIntent || !item.completionCondition || !item.businessOutcome) continue;
      const key = item.flowTitle.toLowerCase();
      if (existingTitles.has(key)) continue;
      const path = byPath.get(item.pathId);
      const arc = this.pass1().createArc({
        title: item.flowTitle,
        concept: item.reason,
        businessActor: item.businessActor,
        businessIntent: item.businessIntent,
        confidence: item.confidence,
        qualifiesAsBusinessUseCase: true,
        qualification: 'call_path_preprocessor'
      }, { id: path?.entrySymbolId || '', path: path?.sourcePaths?.[0] || '' });
      if (!arc) continue;
      arc.callPathId = item.pathId;
      arc.callPathVariantIds = arr(path?.alternatives).map((alt) => alt.pathId);
      arc.completionCondition = item.completionCondition;
      arc.businessOutcome = item.businessOutcome;
      arc.semanticBoundaryAt = item.semanticBoundaryAt;
      arc.seedSource = 'call_path_preprocessor';
      this.pass2().seed(arc.id);
      existingTitles.set(key, arc);
      seeded.push(arc);
    }

    state.seededArcIds = seeded.map((arc) => arc.id);
    state.status = 'complete';
    this.state.lastMessage = seeded.length
      ? `Call-path preprocessing seeded ${seeded.length} grouped business-flow candidate${seeded.length === 1 ? '' : 's'} directly into Pass 1; Discovery continues independently.`
      : 'Call-path preprocessing found no direct business-flow seed; Discovery continues independently.';
  }
}
