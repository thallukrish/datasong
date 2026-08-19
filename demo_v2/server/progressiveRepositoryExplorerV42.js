import { ProgressiveRepositoryExplorerV41 } from './progressiveRepositoryExplorerV41.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 360) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const PASS2_FLOW_SYSTEM = `You are DataSong's PASS-2 COMPRESSED-FLOW INTERPRETER.
Pass 1 has already admitted one business-use-case arc.
You receive the ENTIRE deterministic compressed executable flow family for that arc, not one graph node at a time.
Interpret the supplied flow as evidence for the active arc in one pass: identify business stages, entities, persisted objects, relationships, external effects and outcome when directly evidenced.
Do not request repository search, files, arbitrary neighbors, or node-by-node traversal.
Only ask for a branch follow-up when one supplied branch is genuinely ambiguous and materially affects the business map. Otherwise finish the arc interpretation now.
Return strict compact JSON only.`;

export class ProgressiveRepositoryExplorerV42 extends ProgressiveRepositoryExplorerV41 {
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
    if (!map[arc.id]) map[arc.id] = {
      started: false,
      completed: false,
      pendingBranchIndexes: [],
      interpretedBranchIndexes: [],
      wholeFlowCalls: 0,
      branchCalls: 0
    };
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
      payload = {
        pathId: flowPackage.pathId,
        branchIndex,
        context: {
          prefix: arr(flowPackage.flow.prefix),
          suffix: arr(flowPackage.flow.suffix)
        },
        branch,
        terminal: flowPackage.terminal
      };
    }

    return {
      id: `${isBranch ? 'pass2-flow-branch' : 'pass2-whole-flow'}:${arc.id}:${isBranch ? branchIndex : 'all'}`,
      path: arc.seedSourcePath || arc.callPathId || arc.id,
      kind: 'semantic_neighborhood',
      summary: isBranch
        ? `Compressed unresolved branch ${branchIndex} for ${arc.title}`
        : `Entire compressed executable flow family for ${arc.title}`,
      canonical: {
        kind: isBranch ? 'call_graph_branch_summary' : 'call_graph_flow_summary',
        arcId: arc.id,
        branchIndex: isBranch ? branchIndex : null,
        executableFlow: payload,
        policy: isBranch
          ? 'Interpret only this previously unresolved branch; no repository traversal.'
          : 'Interpret the complete precomputed flow family in one semantic pass; request follow-up only for materially ambiguous supplied branches.'
      },
      neighbors: [],
      sourceCoverage: null
    };
  }

  isWholeFlowObservation(observation) {
    return ['call_graph_flow_summary', 'call_graph_branch_summary'].includes(observation?.canonical?.kind);
  }

  wholeFlowPrompt(observation) {
    const arc = this.pass1().activeArc();
    const state = this.flowState(arc);
    const flow = observation?.canonical?.executableFlow || {};
    const branchCount = arr(flow?.flow?.branches).length;
    const arcView = arc ? {
      arcId: arc.id,
      title: arc.title || '',
      actor: arc.businessActor || arc.trigger || '',
      intent: arc.businessIntent || '',
      completionCondition: arc.completionCondition || '',
      businessOutcome: arc.businessOutcome || arc.outcome || '',
      knownStages: arr(arc.majorStages),
      knownEntities: arr(arc.entities),
      knownPersistentObjects: arr(arc.persistentObjects),
      knownRelationships: arr(arc.relationships),
      knownExternalEffects: arr(arc.externalEffects)
    } : null;

    const contract = {
      meaning: 'brief business interpretation of the supplied complete flow or branch',
      arcFit: { continuity: 0, coherence: 0, expectedGain: 0, reason: 'brief' },
      arcUpdate: {
        evidenceRole: 'major|supporting|trivial',
        trigger: 'only if newly evidenced',
        majorStages: ['business stages evidenced anywhere in this supplied flow'],
        outcome: 'business outcome/effect evidenced by this supplied flow',
        entities: ['major business entities'],
        persistentObjects: ['persisted records/entities/documents directly evidenced'],
        relationships: ['major business/data relationships'],
        externalEffects: ['externally visible effects directly evidenced'],
        status: 'forming|broadly_complete|unresolved'
      },
      unresolvedBranches: [{
        branchIndex: '0-based exact branch index from executableFlow.flow.branches',
        reason: 'why this branch needs a separate semantic pass'
      }],
      flowAction: 'complete|inspect_branches|scout'
    };

    return [
      'MODE pass2-whole-compressed-flow-v1',
      `ACTIVE_ARC ${JSON.stringify(arcView)}`,
      `EXECUTABLE_FLOW ${JSON.stringify(flow)}`,
      `ALREADY_INTERPRETED_BRANCHES ${JSON.stringify(arr(state?.interpretedBranchIndexes))}`,
      `RETURN ${JSON.stringify(contract)}`,
      'Rules:',
      '- Use the entire supplied deterministic flow at once; do not walk it node by node.',
      '- Reconstruct the business map from executable order, branches, entity operations and terminal effects that are actually present.',
      '- unresolvedBranches is normally empty. Use it only when a supplied branch is materially ambiguous and affects the business interpretation.',
      `- For this payload valid unresolved branch indexes are 0..${Math.max(-1, branchCount - 1)}.`,
      '- flowAction=complete when the supplied flow is enough to update/finish this arc.',
      '- flowAction=inspect_branches only when unresolvedBranches is non-empty.',
      '- flowAction=scout only when an important business gap cannot be answered by this supplied flow family.',
      '- Never request repository artifacts, neighbors, or searches.',
      '- Keep strings compact.'
    ].join('\n');
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

  normalizeWholeFlowPass2(raw, observation) {
    const arc = this.pass1().activeArc();
    const fit = raw?.arcFit && typeof raw.arcFit === 'object' ? raw.arcFit : {};
    const update = raw?.arcUpdate && typeof raw.arcUpdate === 'object' ? raw.arcUpdate : {};
    const canonical = observation?.canonical || {};
    const executableFlow = canonical.executableFlow || {};
    const branches = arr(executableFlow?.flow?.branches);
    const isBranch = canonical.kind === 'call_graph_branch_summary';

    const unresolved = isBranch ? [] : arr(raw?.unresolvedBranches)
      .map((item) => ({
        branchIndex: Number(item?.branchIndex),
        reason: text(item?.reason, 220)
      }))
      .filter((item) => Number.isInteger(item.branchIndex) && item.branchIndex >= 0 && item.branchIndex < branches.length);

    let action = ['complete', 'inspect_branches', 'scout'].includes(raw?.flowAction) ? raw.flowAction : 'complete';
    if (action === 'inspect_branches' && !unresolved.length) action = 'complete';

    const pass12Raw = {
      meaning: raw?.meaning,
      evidenceClassification: 'business_supporting',
      arcFits: arc ? [{
        arcId: arc.id,
        continuity: clamp01(fit.continuity),
        coherence: clamp01(fit.coherence),
        expectedGain: clamp01(fit.expectedGain),
        reason: text(fit.reason, 220)
      }] : [],
      hypothesisJudgments: [],
      bestArc: arc?.id || 'UNATTACHED',
      newArcs: [],
      arcUpdate: {
        ...update,
        arcId: arc?.id || '',
        status: action === 'complete' ? 'broadly_complete' : (update.status || 'unresolved')
      },
      candidateScores: [],
      evidenceRequest: action === 'inspect_branches'
        ? { type: 'advance', reason: 'interpret explicitly unresolved compressed-flow branch' }
        : action === 'scout'
          ? { type: 'backtrack', reason: 'important evidence gap is outside this compressed flow family' }
          : { type: 'stop', reason: 'whole compressed flow interpreted' }
    };

    const parsed = this.normalizePass12(pass12Raw, []);
    parsed._wholeFlowPass2 = true;
    parsed.flowAction = action;
    parsed.unresolvedBranches = unresolved;
    parsed.branchIndex = isBranch ? Number(canonical.branchIndex) : null;
    return parsed;
  }

  async getSemanticUpdate(args) {
    if (!String(args.dynamicPrompt || '').startsWith('MODE pass2-whole-compressed-flow-v1')) {
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
        const parsed = this.normalizeWholeFlowPass2(JSON.parse(result.raw), args.observation);
        const arc = this.pass1().activeArc();
        const state = this.flowState(arc);
        if (state) {
          if (args.observation?.canonical?.kind === 'call_graph_branch_summary') {
            state.branchCalls += 1;
            const branchIndex = Number(args.observation.canonical.branchIndex);
            if (Number.isInteger(branchIndex) && !state.interpretedBranchIndexes.includes(branchIndex)) state.interpretedBranchIndexes.push(branchIndex);
          } else {
            state.wholeFlowCalls += 1;
          }
          state.pendingBranchIndexes = parsed.unresolvedBranches.map((item) => item.branchIndex)
            .filter((index) => !state.interpretedBranchIndexes.includes(index));
          state.completed = parsed.flowAction === 'complete' || (args.observation?.canonical?.kind === 'call_graph_branch_summary' && state.pendingBranchIndexes.length === 0);
          if (parsed.flowAction === 'scout') {
            this.scout().ensureState().pendingReason = `Whole compressed flow for ${arc?.id || 'active arc'} has an unresolved business gap`;
            state.completed = true;
          }
        }
        await this.appendRunLog({
          type: 'pass2_whole_flow_applied',
          call: result.callNumber,
          explorationStep: this.state.step,
          retry,
          timestamp: new Date().toISOString(),
          arcId: arc?.id || '',
          branchIndex: args.observation?.canonical?.branchIndex ?? null,
          parsedResponse: parsed
        });
        return { ...result, parsed };
      } catch (error) {
        lastError = error;
        await this.appendRunLog({
          type: 'llm_invalid_pass2_whole_flow',
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
    // A whole-flow call that neither completed nor named an unresolved branch is
    // treated as complete rather than falling back to node-by-node traversal.
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
      // Never fall through to V41/V40 node traversal for an indexed whole-flow arc.
      state.completed = true;
      return null;
    }
    return super.resolveNextAction(action, candidates);
  }
}
