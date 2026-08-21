const arr = (value) => Array.isArray(value) ? value : [];
const clamp01 = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};
const text = (value, max = 320) => {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const PRIORITY_CLASSES = new Set(['core_end_user','revenue_critical','core_business','operational','support','reporting','admin','configuration','technical']);

const CONTRACT = { summary: 'brief assessment of the supplied executable flow candidates', paths: [{ pathId: 'exact supplied pathId', classification: 'business_flow|technical|uncertain', confidence: 0, flowTitle: 'title for the coherent flow segment only', businessActor: 'if evidenced', businessIntent: 'if evidenced', completionCondition: 'if evidenced', businessOutcome: 'if evidenced', businessPriority: 0, priorityClass: 'core_end_user|revenue_critical|core_business|operational|support|reporting|admin|configuration|technical', priorityReason: 'short reason for business importance', semanticBoundaryAt: 'optional compact flow token where another concern begins', coherentThroughSignature: 'last compact flow token belonging to this flow', reason: 'short evidence-based reason' }] };
const RULES = `Rules:\n- Use only the supplied compact normalized executable structure and terminal boundary.\n- External calls terminate the known repository path; never imagine their implementation.\n- transition/service/entity/navigate tokens describe executable business structure; navigate may mark a semantic boundary.\n- If behavior after a navigation serves a different actor goal, describe only the coherent prefix before the new concern.\n- For business_flow paths, coherentThroughSignature must be one exact compact token appearing in flowSequence, flow.prefix, flow.branches, or flow.suffix.\n- Rank business flows by business importance: core customer/end-user and revenue-critical journeys first, then core business/operational, support/reporting, admin/configuration; technical stays lowest.\n- businessPriority controls exploration order, not whether a valid low-priority business flow eventually gets explored.\n- Do NOT compare paths for containment or infer parent/subflow relationships. Structural grouping is deterministic.\n- Mark technical/framework-only paths technical.\n- Classify every supplied path and keep reasons short.`;

export const withInitialCallPathClassifier = (Base) => class InitialCallPathClassifierExplorer extends Base {
  compactCallPath(path) {
    const merged = path?.mergedStructure;
    const terminal = path?.terminal?.type === 'external'
      ? { type: 'external', calls: arr(path.terminal.calls).map((call) => String(call.name || '')).filter(Boolean) }
      : path?.terminal?.type === 'cycle' ? { type: 'cycle' } : { type: 'end' };
    const base = { pathId: path.id, functionCount: Number(path.functionCount || 0), variants: Number(path.branchVariantCount || 1) + Number(path.alternateEntranceCount || 0) + Number(path.duplicateVariantCount || 0), alternateEntranceCount: Number(path.alternateEntranceCount || 0), terminal };
    if (merged) return { ...base, flow: { prefix: arr(merged.commonPrefix), branches: arr(merged.branches), suffix: arr(merged.commonSuffix) } };
    return { ...base, flowSequence: arr(path.normalizedFlowTokens) };
  }

  callPathPrompt() {
    const paths = this.topology.topCallPaths(10).map((path) => this.compactCallPath(path));
    return ['MODE call-path-business-seed-classification-v4', `RETURN_CONTRACT ${JSON.stringify(CONTRACT)}`, RULES, `DYNAMIC_EXECUTABLE_FLOW_CANDIDATES ${JSON.stringify(paths)}`].join('\n');
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
      return this.lightweightModelCall(`You are lemap's CALL-PATH BUSINESS-FLOW SEED CLASSIFIER. You receive compact deterministic normalized executable flow structures from the supplied repository boundary. Do not reconstruct omitted source/XML details or infer implementations for external calls. Classify each coherent business flow and assign business priority. Return strict compact JSON only.`, dynamicPrompt, 'CALL-PATH BUSINESS-FLOW SEED CLASSIFIER V4');
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  normalizeCallPathClassification(raw) {
    const parsed = super.normalizeCallPathClassification(raw);
    const byId = new Map(arr(raw?.paths).map((item) => [item?.pathId, item]));
    parsed.paths = arr(parsed.paths).map((item) => {
      const source = byId.get(item.pathId) || {};
      return { ...item, businessPriority: clamp01(source.businessPriority), priorityClass: PRIORITY_CLASSES.has(source.priorityClass) ? source.priorityClass : (item.classification === 'technical' ? 'technical' : 'core_business'), priorityReason: text(source.priorityReason, 300) };
    });
    return parsed;
  }

  async getSemanticUpdate(args) {
    if (!String(args.dynamicPrompt || '').startsWith('MODE call-path-business-seed-classification-v4')) return super.getSemanticUpdate(args);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${args.dynamicPrompt}\nRETRY: return complete valid JSON only.` : args.dynamicPrompt;
      const result = await this.callAndRecordAttempt({ dynamicPrompt: prompt, observation: args.observation, candidates: [], before: args.before, maxTokens: undefined, retry });
      try { return { ...result, parsed: this.normalizeCallPathClassification(JSON.parse(result.raw)) }; }
      catch (error) {
        lastError = error;
        await this.appendRunLog({ type: 'llm_invalid_call_path_classification', call: result.callNumber, explorationStep: this.state.step, retry, timestamp: new Date().toISOString(), error: error.message, rawResponse: result.raw, usage: result.usage, cumulativeUsage: { ...this.state.tokenUsage } });
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
      arc.opportunityScore = Math.max(Number(arc.opportunityScore || 0), Number(arc.businessPriority || 0));
    }
    return result;
  }
};
