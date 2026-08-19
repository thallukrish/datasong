import { ProgressiveRepositoryExplorerV40 } from './progressiveRepositoryExplorerV40.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 360) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const PASS2_GRAPH_SYSTEM = `You are DataSong's PASS-2 CALL-GRAPH INTERPRETER.
Pass 1 has already admitted a business-use-case arc. Pass 2 does not search the repository and does not rediscover source structure.
You receive one position in a deterministic precomputed executable call-path family plus its exact known next graph nodes.
Interpret the current graph evidence for the active business arc, update the business map when evidenced, and score ONLY the supplied next graph nodes for continuation.
Do not request files, arbitrary neighbors, or semantic search. DataSong owns graph navigation and branching.
Return strict compact JSON only.`;

export class ProgressiveRepositoryExplorerV41 extends ProgressiveRepositoryExplorerV40 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'callgraph-pass1-pass2-dedicated-interpreter-v21';
    return state;
  }

  isCallGraphObservation(observation) {
    return observation?.canonical?.kind === 'call_graph_navigation';
  }

  graphPrompt(observation, candidates) {
    const arc = this.pass1().activeArc();
    const current = observation?.canonical || {};
    const available = arr(candidates).map((candidate) => ({
      artifactId: candidate.id,
      function: candidate.label || '',
      relation: candidate.relation || 'call_graph',
      signature: text(candidate.hint, 260)
    }));
    const arcView = arc ? {
      arcId: arc.id,
      title: arc.title || '',
      actor: arc.businessActor || arc.trigger || '',
      intent: arc.businessIntent || '',
      completionCondition: arc.completionCondition || '',
      businessOutcome: arc.businessOutcome || arc.outcome || '',
      progress: Number(arc.progress || 0),
      knownStages: arr(arc.majorStages),
      knownEntities: arr(arc.entities),
      knownPersistentObjects: arr(arc.persistentObjects),
      knownRelationships: arr(arc.relationships),
      knownExternalEffects: arr(arc.externalEffects)
    } : null;

    const contract = {
      meaning: 'brief meaning of CURRENT graph node for ACTIVE_ARC',
      evidenceClassification: 'business_use_case|business_supporting|orientation|technical',
      arcFit: { continuity: 0, coherence: 0, expectedGain: 0, reason: 'brief' },
      arcUpdate: {
        evidenceRole: 'major|supporting|trivial',
        trigger: 'only if newly evidenced',
        majorStages: ['new business stage only'],
        outcome: 'new business outcome/effect only',
        entities: ['new major entity only'],
        persistentObjects: ['persisted record/entity/document only when evidenced'],
        relationships: ['new major relationship only'],
        externalEffects: ['externally visible side effect only when evidenced'],
        status: 'forming|broadly_complete|unresolved'
      },
      branchScores: [{
        artifactId: 'exact NEXT_GRAPH_NODES artifactId',
        continuity: 0,
        coherence: 0,
        expectedGain: 0,
        reason: 'brief'
      }],
      graphAction: 'advance|backtrack|complete'
    };

    return [
      'MODE pass2-callgraph-navigation-v1',
      `ACTIVE_ARC ${JSON.stringify(arcView)}`,
      `CURRENT_GRAPH_POSITION ${JSON.stringify(current)}`,
      `NEXT_GRAPH_NODES ${JSON.stringify(available)}`,
      `RETURN ${JSON.stringify(contract)}`,
      'Rules:',
      '- Interpret only CURRENT_GRAPH_POSITION and NEXT_GRAPH_NODES.',
      '- branchScores may contain only exact supplied artifactIds.',
      '- Score continuation against ACTIVE_ARC, not general technical relevance.',
      '- graphAction=advance when at least one supplied next node materially continues the arc.',
      '- graphAction=backtrack when supplied branches are weak or unrelated.',
      '- graphAction=complete when the known arc completion/outcome is now sufficiently evidenced.',
      '- Never request repository search, arbitrary files, or arbitrary neighbors.',
      '- Keep strings short.'
    ].join('\n');
  }

  buildPrompt(observation, candidates) {
    if (this.isCallGraphObservation(observation)) return this.graphPrompt(observation, candidates);
    return super.buildPrompt(observation, candidates);
  }

  async callModel(dynamicPrompt, maxTokens) {
    if (String(dynamicPrompt || '').startsWith('MODE pass2-callgraph-navigation-v1')) {
      return this.lightweightModelCall(PASS2_GRAPH_SYSTEM, dynamicPrompt, 'PASS 2 CALL-GRAPH INTERPRETER');
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  normalizeGraphPass2(raw, candidates) {
    const arc = this.pass1().activeArc();
    const fit = raw?.arcFit && typeof raw.arcFit === 'object' ? raw.arcFit : {};
    const update = raw?.arcUpdate && typeof raw.arcUpdate === 'object' ? raw.arcUpdate : {};
    const known = new Set(arr(candidates).map((candidate) => candidate.id));
    const scores = arr(raw?.branchScores)
      .filter((item) => known.has(item?.artifactId))
      .map((item) => ({
        artifactId: item.artifactId,
        arcId: arc?.id || '',
        continuity: item.continuity,
        coherence: item.coherence,
        expectedGain: item.expectedGain,
        reason: item.reason
      }));

    const action = ['advance', 'backtrack', 'complete'].includes(raw?.graphAction)
      ? raw.graphAction
      : (scores.length ? 'advance' : 'backtrack');

    const pass12Raw = {
      meaning: raw?.meaning,
      evidenceClassification: raw?.evidenceClassification,
      arcFits: arc ? [{
        arcId: arc.id,
        continuity: fit.continuity,
        coherence: fit.coherence,
        expectedGain: fit.expectedGain,
        reason: fit.reason
      }] : [],
      hypothesisJudgments: [],
      bestArc: arc?.id || 'UNATTACHED',
      newArcs: [],
      arcUpdate: {
        ...update,
        arcId: arc?.id || '',
        status: action === 'complete' ? 'broadly_complete' : update.status
      },
      candidateScores: scores,
      evidenceRequest: action === 'advance'
        ? { type: 'advance', reason: 'continue precomputed call graph' }
        : action === 'complete'
          ? { type: 'stop', reason: 'active arc completion is sufficiently evidenced' }
          : { type: 'backtrack', reason: 'current precomputed graph branch is weak/exhausted' }
    };

    return this.normalizePass12(pass12Raw, candidates);
  }

  async getSemanticUpdate(args) {
    if (!String(args.dynamicPrompt || '').startsWith('MODE pass2-callgraph-navigation-v1')) {
      return super.getSemanticUpdate(args);
    }

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${args.dynamicPrompt}\nRETRY: return complete valid JSON only.` : args.dynamicPrompt;
      const result = await this.callAndRecordAttempt({
        dynamicPrompt: prompt,
        observation: args.observation,
        candidates: args.candidates,
        before: args.before,
        maxTokens: undefined,
        retry
      });
      try {
        const parsed = this.normalizeGraphPass2(JSON.parse(result.raw), args.candidates);
        this._lastParsedCandidateScores = arr(parsed.candidateScores);
        await this.appendRunLog({
          type: 'pass2_callgraph_applied',
          call: result.callNumber,
          explorationStep: this.state.step,
          retry,
          timestamp: new Date().toISOString(),
          arcId: this.pass1().activeArcId(),
          graphPosition: args.observation?.canonical?.anchor?.id || '',
          candidateCount: arr(args.candidates).length,
          parsedResponse: parsed
        });
        return { ...result, parsed };
      } catch (error) {
        lastError = error;
        await this.appendRunLog({
          type: 'llm_invalid_pass2_callgraph',
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
    throw new Error(`No valid Pass-2 call-graph response after retry: ${lastError?.message || 'unknown error'}`);
  }
}
