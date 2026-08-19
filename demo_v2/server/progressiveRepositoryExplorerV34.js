import { ProgressiveRepositoryExplorerV33 } from './progressiveRepositoryExplorerV33.js';

function arr(value) { return Array.isArray(value) ? value : []; }

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
- Do NOT compare paths, infer parent/subflow relationships, or decide which flow is broader. DataSong handles structural grouping and containment deterministically.
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

    return {
      ...base,
      flowSequence: arr(path.normalizedFlowTokens)
    };
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

  async callModel(dynamicPrompt, maxTokens) {
    if (String(dynamicPrompt || '').startsWith('MODE call-path-business-seed-classification-v4')) {
      return this.lightweightModelCall(
        `You are DataSong's CALL-PATH BUSINESS-FLOW SEED CLASSIFIER.\nYou receive compact deterministic normalized executable flow structures from the supplied repository boundary.\nDo not reconstruct omitted source/XML details and do not infer implementations for external calls.\nFor each supplied candidate decide only whether its coherent segment is a business_flow, technical, or uncertain.\nA business_flow is one recognizable actor/business goal with a completion condition and outcome.\nReturn strict compact JSON only.`,
        dynamicPrompt,
        'CALL-PATH BUSINESS-FLOW SEED CLASSIFIER V4'
      );
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  async getSemanticUpdate(args) {
    if (!String(args.dynamicPrompt || '').startsWith('MODE call-path-business-seed-classification-v4')) {
      return super.getSemanticUpdate(args);
    }

    // V31 already owns the parsing/normalization contract for call-path classifier
    // responses. Its mode guard is v3-specific, so temporarily use the same
    // call/retry mechanics here and reuse normalizeCallPathClassification().
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
}
