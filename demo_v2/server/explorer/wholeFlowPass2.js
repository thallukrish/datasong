const arr = (value) => Array.isArray(value) ? value : [];

const PASS2_FLOW_SYSTEM = `You are DataSong's PASS-2 COMPRESSED-FLOW INTERPRETER.
Pass 1 has already admitted one business-use-case arc.
You receive the deterministic compressed executable flow family for that arc, plus the one concrete path selected by Pass 1.
When coherentThroughSignature is supplied, it is the semantic end of the admitted business flow. Do not sequence executable behavior after that boundary as part of the workflow.
When selectedFlowSequence is supplied, it is the concrete admitted path clipped through that boundary.
When functionEvidence is supplied, its source bodies are direct implementation evidence from that same clipped concrete path.
Interpret the supplied flow as evidence for the active arc in one pass.
Do not request repository search, files, arbitrary neighbors, or node-by-node traversal.
Only ask for a branch follow-up when one supplied branch is genuinely ambiguous and materially affects the business map.
Return strict compact JSON only.`;

export const withWholeFlowPass2 = (Base) => class WholeFlowPass2Explorer extends Base {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'callgraph-whole-flow-pass2-v23';
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

  concretePathCandidates(grouped) {
    if (!grouped) return [];
    return [
      grouped,
      ...arr(grouped.alternatives).map((alternative) => ({
        ...alternative,
        id: alternative?.pathId || alternative?.id || ''
      }))
    ].filter((path) => arr(path?.symbolIds).length);
  }

  clipConcretePathAtBoundary(selected, through) {
    if (!selected) return null;
    const boundary = String(through || '').trim();
    if (!boundary) return selected;
    const tokens = arr(selected?.normalizedFlowTokens);
    const index = tokens.findIndex((token) => token === boundary);
    if (index < 0) return selected;
    return {
      ...selected,
      normalizedFlowTokens: tokens.slice(0, index + 1),
      symbolIds: arr(selected?.symbolIds).slice(0, index + 1),
      coherentBoundaryIndex: index
    };
  }

  selectedConcretePath(grouped, arc) {
    const candidates = this.concretePathCandidates(grouped);
    if (!candidates.length) return null;

    const through = String(arc?.coherentThroughSignature || '').trim();
    if (!through) return candidates[0];

    const matching = candidates.filter((candidate) => arr(candidate?.normalizedFlowTokens).includes(through));
    let selected = null;
    if (matching.length === 1) selected = matching[0];
    else {
      // If the boundary token is shared by several variants it does not uniquely
      // identify a branch. Keep the representative path rather than expanding all
      // alternatives and flooding Pass 2 with unrelated implementation bodies.
      const representative = candidates[0];
      selected = matching.includes(representative) ? representative : (matching[0] || representative);
    }
    return this.clipConcretePathAtBoundary(selected, through);
  }

  functionEvidenceForGroupedPath(grouped, arc) {
    const selected = this.selectedConcretePath(grouped, arc);
    if (!selected) return [];
    const seen = new Set();
    const evidence = [];
    for (const symbolId of arr(selected.symbolIds)) {
      if (!symbolId || seen.has(symbolId)) continue;
      seen.add(symbolId);
      const symbol = this.topology?.symbolById?.get?.(symbolId);
      const body = String(symbol?.body || '').trim();
      if (!symbol || !body) continue;
      evidence.push({
        symbolId,
        name: String(symbol.name || ''),
        signature: String(symbol.signature || ''),
        sourcePath: String(symbol.sourcePath || ''),
        body
      });
    }
    return evidence;
  }

  compactFlowPackage(arc) {
    const grouped = this.groupedPathForArc(arc);
    if (!grouped) return null;
    const compact = this.compactCallPath(grouped);
    const selected = this.selectedConcretePath(grouped, arc);
    const functionEvidence = this.functionEvidenceForGroupedPath(grouped, arc);
    const coherentThroughSignature = String(arc?.coherentThroughSignature || '').trim();
    return {
      pathId: compact.pathId,
      selectedConcretePathId: selected?.id || selected?.pathId || grouped?.id || '',
      ...(coherentThroughSignature ? { coherentThroughSignature } : {}),
      ...(Number.isInteger(selected?.coherentBoundaryIndex) ? { coherentBoundaryIndex: selected.coherentBoundaryIndex } : {}),
      selectedFlowSequence: arr(selected?.normalizedFlowTokens),
      selectedSymbolCount: arr(selected?.symbolIds).length,
      functionCount: compact.functionCount,
      variants: compact.variants,
      alternateEntranceCount: compact.alternateEntranceCount,
      terminal: compact.terminal,
      structuralEvidence: compact.structuralEvidence || { entities: [], entityBoundaries: [], persistence: [] },
      ...(functionEvidence.length ? { functionEvidence } : {}),
      ...(compact.flow ? { flow: compact.flow } : { flowSequence: arr(selected?.normalizedFlowTokens).length ? arr(selected.normalizedFlowTokens) : arr(compact.flowSequence) })
    };
  }

  normalizeWholeFlowPass2(raw, observation) {
    const arc = this.pass1().activeArc();
    const fit = raw?.arcFit && typeof raw.arcFit === 'object' ? raw.arcFit : {};
    const update = raw?.arcUpdate && typeof raw.arcUpdate === 'object' ? raw.arcUpdate : {};
    const normalized = this.normalizePass12({
      meaning: String(raw?.meaning || '').trim(),
      evidenceClassification: 'business_use_case',
      arcFits: arc ? [{
        arcId: arc.id,
        continuity: fit.continuity,
        coherence: fit.coherence,
        expectedGain: fit.expectedGain,
        reason: fit.reason
      }] : [],
      bestArc: arc?.id || 'UNATTACHED',
      newArcs: [],
      arcUpdate: { ...update, arcId: arc?.id || update.arcId || '' },
      candidateScores: [],
      evidenceRequest: { type: 'stop' }
    }, []);

    const maxBranch = Math.max(-1, arr(observation?.canonical?.executableFlow?.flow?.branches).length - 1);
    normalized.unresolvedBranches = arr(raw?.unresolvedBranches)
      .map((item) => ({ branchIndex: Number(item?.branchIndex), reason: String(item?.reason || '').trim() }))
      .filter((item) => Number.isInteger(item.branchIndex) && item.branchIndex >= 0 && item.branchIndex <= maxBranch);
    normalized.flowAction = ['complete', 'inspect_branches', 'scout'].includes(raw?.flowAction)
      ? raw.flowAction
      : (normalized.unresolvedBranches.length ? 'inspect_branches' : 'complete');
    normalized._wholeFlowPass2 = true;
    normalized.next = { type: 'stop' };
    return normalized;
  }

  wholeFlowObservation(arc, branchIndex = null) {
    const flowPackage = this.compactFlowPackage(arc);
    if (!flowPackage) return null;
    const isBranch = Number.isInteger(branchIndex);
    let payload = flowPackage;
    if (isBranch && flowPackage.flow) {
      const branch = arr(flowPackage.flow.branches)[branchIndex];
      if (!branch) return null;
      payload = {
        pathId: flowPackage.pathId,
        selectedConcretePathId: flowPackage.selectedConcretePathId,
        coherentThroughSignature: flowPackage.coherentThroughSignature || '',
        selectedFlowSequence: flowPackage.selectedFlowSequence,
        selectedSymbolCount: flowPackage.selectedSymbolCount,
        branchIndex,
        context: { prefix: arr(flowPackage.flow.prefix), suffix: arr(flowPackage.flow.suffix) },
        branch,
        terminal: flowPackage.terminal,
        structuralEvidence: flowPackage.structuralEvidence,
        ...(arr(flowPackage.functionEvidence).length ? { functionEvidence: flowPackage.functionEvidence } : {})
      };
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
        policy: isBranch
          ? 'Interpret only this previously unresolved branch; no repository traversal. Respect coherentThroughSignature as the semantic boundary of the admitted business flow.'
          : 'Interpret the complete precomputed flow family in one semantic pass. Treat selectedFlowSequence/functionEvidence as the admitted concrete path and do not sequence behavior after coherentThroughSignature as part of the workflow.'
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
        const flow = args.observation?.canonical?.executableFlow || {};
        await this.appendRunLog({
          type: 'pass2_whole_flow_applied',
          call: result.callNumber,
          explorationStep: this.state.step,
          retry,
          timestamp: new Date().toISOString(),
          arcId: arc?.id || '',
          branchIndex: args.observation?.canonical?.branchIndex ?? null,
          evidence: {
            pathId: flow.pathId || '',
            selectedConcretePathId: flow.selectedConcretePathId || '',
            coherentThroughSignature: flow.coherentThroughSignature || '',
            coherentBoundaryIndex: Number.isInteger(flow.coherentBoundaryIndex) ? flow.coherentBoundaryIndex : null,
            selectedSymbolCount: Number(flow.selectedSymbolCount || 0),
            functionEvidenceCount: arr(flow.functionEvidence).length,
            structuralEvidence: flow.structuralEvidence || null,
            functionEvidence: arr(flow.functionEvidence).map((item) => ({
              symbolId: item?.symbolId || '',
              name: item?.name || '',
              sourcePath: item?.sourcePath || '',
              bodyChars: String(item?.body || '').length
            }))
          },
          parsedResponse: parsed
        });
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
