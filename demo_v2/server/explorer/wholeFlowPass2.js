const arr = (value) => Array.isArray(value) ? value : [];

const PASS2_FLOW_SYSTEM = `You are DataSong's PASS-2 COMPRESSED-FLOW INTERPRETER.
Pass 1 has already admitted one business-use-case arc.
You receive the ENTIRE deterministic compressed executable flow family for that arc, not one graph node at a time.
Interpret the supplied flow as evidence for the active arc in one pass.
Do not request repository search, files, arbitrary neighbors, or node-by-node traversal.
Only ask for a branch follow-up when one supplied branch is genuinely ambiguous and materially affects the business map.
Return strict compact JSON only.`;

export const withWholeFlowPass2 = (Base) => class WholeFlowPass2Explorer extends Base {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'callgraph-whole-flow-pass2-v22';
    state.pass2WholeFlowByArc = {};
    return state;
  }

  ensureWholeFlowState() {
    if (!this.state.pass2WholeFlowByArc) this.state.pass2WholeFlowByArc = {};
    return this.state.pass2WholeFlowByArc;
  }

  flowState(arc) {
    if (!arc) return null;
    const map = this.ensureWholeFlowState();
    if (!map[arc.id]) map[arc.id] = { started: false, completed: false, pendingBranchIndexes: [], interpretedBranchIndexes: [], wholeFlowCalls: 0, branchCalls: 0 };
    return map[arc.id];
  }

  compactFlowPackage(arc) {
    const grouped = this.groupedPathForArc(arc);
    if (!grouped) return null;
    const compact = this.compactCallPath(grouped);
    return {
      pathId: compact.pathId,
      functionCount: compact.functionCount,
      variants: compact.variants,
      alternateEntranceCount: compact.alternateEntranceCount,
      terminal: compact.terminal,
      ...(compact.flow ? { flow: compact.flow } : { flowSequence: arr(compact.flowSequence) })
    };
  }

  wholeFlowObservation(arc, branchIndex = null) {
    const flowPackage = this.compactFlowPackage(arc);
    if (!flowPackage) return null;
    const isBranch = Number.isInteger(branchIndex);
    let payload = flowPackage;
    if (isBranch && flowPackage.flow) {
      const branch = arr(flowPackage.flow.branches)[branchIndex];
      if (!branch) return null;
      payload = { pathId: flowPackage.pathId, branchIndex, context: { prefix: arr(flowPackage.flow.prefix), suffix: arr(flowPackage.flow.suffix) }, branch, terminal: flowPackage.terminal };
    }
    return {
      id: `${isBranch ? 'pass2-flow-branch' : 'pass2-whole-flow'}:${arc.id}:${isBranch ? branchIndex : 'all'}`,
      path: arc.seedSourcePath || arc.callPathId || arc.id,
      kind: 'semantic_neighborhood',
      summary: isBranch ? `Compressed unresolved branch ${branchIndex} for ${arc.title}` : `Entire compressed executable flow family for ${arc.title}`,
      canonical: {
        kind: isBranch ? 'call_graph_branch_summary' : 'call_graph_flow_summary',
        arcId: arc.id,
        branchIndex: isBranch ? branchIndex : null,
        executableFlow: payload,
        policy: isBranch ? 'Interpret only this previously unresolved branch; no repository traversal.' : 'Interpret the complete precomputed flow family in one semantic pass; request follow-up only for materially ambiguous supplied branches.'
      },
      neighbors: [], sourceCoverage: null
    };
  }

  isWholeFlowObservation(observation) {
    return ['call_graph_flow_summary', 'call_graph_branch_summary'].includes(observation?.canonical?.kind);
  }

  buildPrompt(observation, candidates) {
    if (this.isWholeFlowObservation(observation)) return this.wholeFlowPrompt(observation);
    return super.buildPrompt(observation, candidates);
  }

  async callModel(dynamicPrompt, maxTokens) {
    if (String(dynamicPrompt || '').startsWith('MODE pass2-whole-compressed-flow-v1')) {
      return this.lightweightModelCall(PASS2_FLOW_SYSTEM, dynamicPrompt, 'PASS 2 WHOLE COMPRESSED FLOW INTERPRETER');
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  async getSemanticUpdate(args) {
    if (!String(args.dynamicPrompt || '').startsWith('MODE pass2-whole-compressed-flow-v1')) return super.getSemanticUpdate(args);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${args.dynamicPrompt}\nRETRY: return complete valid JSON only.` : args.dynamicPrompt;
      const result = await this.callAndRecordAttempt({ dynamicPrompt: prompt, observation: args.observation, candidates: [], before: args.before, maxTokens: undefined, retry });
      try {
        const parsed = this.normalizeWholeFlowPass2(JSON.parse(result.raw), args.observation);
        const arc = this.pass1().activeArc();
        const state = this.flowState(arc);
        if (state) {
          if (args.observation?.canonical?.kind === 'call_graph_branch_summary') {
            state.branchCalls += 1;
            const branchIndex = Number(args.observation.canonical.branchIndex);
            if (Number.isInteger(branchIndex) && !state.interpretedBranchIndexes.includes(branchIndex)) state.interpretedBranchIndexes.push(branchIndex);
          } else state.wholeFlowCalls += 1;
          state.pendingBranchIndexes = arr(parsed.unresolvedBranches).map((item) => item.branchIndex).filter((index) => !state.interpretedBranchIndexes.includes(index));
          state.completed = parsed.flowAction === 'complete' || (args.observation?.canonical?.kind === 'call_graph_branch_summary' && state.pendingBranchIndexes.length === 0);
          if (parsed.flowAction === 'scout') {
            this.scout().ensureState().pendingReason = `Whole compressed flow for ${arc?.id || 'active arc'} has an unresolved business gap`;
            state.completed = true;
          }
        }
        await this.appendRunLog({ type: 'pass2_whole_flow_applied', call: result.callNumber, explorationStep: this.state.step, retry, timestamp: new Date().toISOString(), arcId: arc?.id || '', branchIndex: args.observation?.canonical?.branchIndex ?? null, parsedResponse: parsed });
        return { ...result, parsed };
      } catch (error) {
        lastError = error;
        await this.appendRunLog({ type: 'llm_invalid_pass2_whole_flow', call: result.callNumber, explorationStep: this.state.step, retry, timestamp: new Date().toISOString(), error: error.message, rawResponse: result.raw, usage: result.usage, cumulativeUsage: { ...this.state.tokenUsage } });
        this.printCallSummary(result.usage, result.callNumber, `rejected/${error.message}`);
      }
    }
    throw new Error(`No valid whole-flow Pass-2 response after retry: ${lastError?.message || 'unknown error'}`);
  }

  startWholeFlowArc(arc) {
    if (!arc) return null;
    const state = this.flowState(arc);
    if (!state || state.started) return null;
    const observation = this.wholeFlowObservation(arc);
    if (!observation) return null;
    state.started = true;
    arc.seedStarted = true;
    arc.graphNavigation = false;
    this.state.executionStack = [];
    this.state.frontier = [];
    const graph = this.ensureGraphState?.()?.[arc.id];
    if (graph) graph.exhausted = true;
    this.state.lastMessage = `Pass 2 interpreting the entire compressed flow for ${arc.title} in one pass.`;
    this.pass1().syncStories();
    this.emit?.();
    return observation;
  }

  async startArcAtSeed(arc) {
    const whole = this.startWholeFlowArc(arc);
    if (whole) return whole;
    return super.startArcAtSeed(arc);
  }

  async resumePass2Arc(arcId) {
    const arc = this.pass1().arcByReference(arcId);
    if (!arc) return null;
    const state = this.flowState(arc);
    if (!state.started) return this.startWholeFlowArc(arc);
    if (state.pendingBranchIndexes.length) {
      const branchIndex = state.pendingBranchIndexes.shift();
      this.state.lastMessage = `Pass 2 resolving branch ${branchIndex + 1} for ${arc.title}.`;
      return this.wholeFlowObservation(arc, branchIndex);
    }
    if (state.completed) return null;
    state.completed = true;
    return null;
  }

  async resolveNextAction(action, candidates) {
    if (this._scheduledArcSwitch) {
      const target = this._scheduledArcSwitch.toArcId;
      this._scheduledArcSwitch = null;
      return this.resumePass2Arc(target);
    }
    const arc = this.pass1().activeArc();
    const state = this.flowState(arc);
    if (state?.started) {
      if (state.pendingBranchIndexes.length) return this.resumePass2Arc(arc.id);
      if (state.completed) return null;
      state.completed = true;
      return null;
    }
    return super.resolveNextAction(action, candidates);
  }
};
