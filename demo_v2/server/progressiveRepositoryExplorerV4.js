import { ProgressiveRepositoryExplorerV3 } from './progressiveRepositoryExplorerV3.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 700) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function score01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export class ProgressiveRepositoryExplorerV4 extends ProgressiveRepositoryExplorerV3 {
  emptyState() {
    const state = super.emptyState();
    state.protoThreads = [];
    return state;
  }

  protoSummary() {
    return this.state.protoThreads.slice(-8).map((proto) => ({
      id: proto.id,
      title: proto.title,
      concept: proto.concept,
      evidence: proto.evidence.slice(-6).map((item) => ({ artifactId: item.artifactId, meaning: item.meaning }))
    }));
  }

  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);
    if (!['xml_file', 'config_file', 'text_file', 'semantic_function'].includes(observation?.kind)) return base;

    const protoContract = {
      protoThreadFits: [{
        protoThreadId: 'existing proto thread id',
        continuity: 0.0,
        coherence: 0.0,
        bridge: 'how the current evidence relates to the accumulated candidate narrative'
      }],
      protoAction: {
        type: 'new|extend|promote|none',
        protoThreadId: 'existing proto id for extend/promote',
        title: 'short candidate/final thread title',
        concept: 'coherent concept represented by accumulated evidence'
      }
    };

    return `${base}\n\nCANDIDATE / PROTO THREADS\n${JSON.stringify(this.protoSummary())}\n\nPROTO-THREAD RETURN FIELDS\n${JSON.stringify(protoContract)}\n\nProto-thread rules:\n- A flow does not need to be obvious from the first artifact. Proto threads hold promising but not-yet-crystallized narratives.\n- Return one protoThreadFits entry for every supplied proto thread. Scores are 0..1.\n- protoAction=new when this evidence is promising but not sufficient for a durable thread yet.\n- protoAction=extend when it coherently continues an existing proto thread but you still need more evidence.\n- protoAction=promote when accumulated evidence across the proto thread plus this artifact now sustains a coherent end-to-end concept. Promotion means the semantic thread should begin now.\n- If bestThread=NEW already, protoAction may be none; do not create a duplicate proto.\n- Do not require one artifact alone to define the whole workflow. Judge continuity/coherence across accumulated evidence.`;
  }

  validateProtoFields(parsed) {
    const protos = this.state.protoThreads;
    const fits = arr(parsed.protoThreadFits);
    for (const proto of protos) {
      const fit = fits.find((entry) => entry?.protoThreadId === proto.id);
      if (!fit) throw new Error(`protoThreadFits missing ${proto.id}`);
      for (const [key, raw] of [['continuity', fit.continuity], ['coherence', fit.coherence]]) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`protoThreadFits.${proto.id}.${key} must be between 0 and 1`);
      }
    }

    const action = parsed.protoAction || { type: 'none' };
    if (!['new', 'extend', 'promote', 'none'].includes(action.type)) throw new Error('protoAction.type must be new|extend|promote|none');
    if (['extend', 'promote'].includes(action.type) && !protos.some((proto) => proto.id === action.protoThreadId)) {
      throw new Error(`${action.type} must reference an existing protoThreadId`);
    }
    if (['new', 'promote'].includes(action.type) && !text(action.title, 160)) throw new Error(`protoAction.${action.type} requires title`);
    if (['new', 'promote'].includes(action.type) && !text(action.concept, 300)) throw new Error(`protoAction.${action.type} requires concept`);
  }

  applyProtoPromotion(parsed) {
    const action = parsed.protoAction || { type: 'none' };
    if (action.type !== 'promote') return parsed;
    const proto = this.state.protoThreads.find((item) => item.id === action.protoThreadId);
    if (!proto) return parsed;

    return {
      ...parsed,
      semanticRole: 'story',
      pathId: 'NEW',
      pathTitle: text(action.title, 160) || proto.title,
      pathNature: text(action.concept, 220) || proto.concept,
      relation: 'new_story',
      continuity: 1,
      bridge: text(action.concept, 500) || text(parsed.meaning, 500),
      _promotedProtoThreadId: proto.id
    };
  }

  async getSemanticUpdate(args) {
    const result = await super.getSemanticUpdate(args);
    if (!['xml_file', 'config_file', 'text_file', 'semantic_function'].includes(args.observation?.kind)) return result;
    this.validateProtoFields(result.parsed);
    return { ...result, parsed: this.applyProtoPromotion(result.parsed) };
  }

  updateProtoThreads(parsed, observation) {
    const action = parsed?.protoAction || { type: 'none' };
    const evidence = {
      artifactId: observation?.id || '',
      meaning: text(parsed?.meaning, 500),
      step: this.state.step
    };

    if (parsed?._promotedProtoThreadId) {
      this.state.protoThreads = this.state.protoThreads.filter((proto) => proto.id !== parsed._promotedProtoThreadId);
      return;
    }

    if (action.type === 'new' && parsed.semanticRole !== 'story') {
      const id = `proto-${this.state.step}-${this.state.protoThreads.length + 1}`;
      this.state.protoThreads.push({
        id,
        title: text(action.title, 160),
        concept: text(action.concept, 300),
        evidence: [evidence],
        createdStep: this.state.step
      });
    } else if (action.type === 'extend') {
      const proto = this.state.protoThreads.find((item) => item.id === action.protoThreadId);
      if (proto) {
        proto.evidence.push(evidence);
        proto.evidence = proto.evidence.slice(-20);
        if (text(action.title, 160)) proto.title = text(action.title, 160);
        if (text(action.concept, 300)) proto.concept = text(action.concept, 300);
      }
    }

    this.state.protoThreads = this.state.protoThreads.slice(-20);
  }

  applyDelta(parsed, observation) {
    const result = super.applyDelta(parsed, observation);
    if (!parsed?._navigationOnly && ['xml_file', 'config_file', 'text_file', 'semantic_function'].includes(observation?.kind)) {
      this.updateProtoThreads(parsed, observation);
    }
    return result;
  }

  chooseScoredCandidate(candidateScores, candidates) {
    const byId = new Map(arr(candidates).map((candidate) => [candidate.id, candidate]));
    const ranked = arr(candidateScores)
      .filter((item) => byId.has(item.artifactId) && !this.state.visited.includes(item.artifactId))
      .map((item) => {
        const candidate = byId.get(item.artifactId);
        const semanticFit = 0.45 * score01(item.continuity) + 0.45 * score01(item.coherence) + 0.10 * score01(item.expectedGain);
        const relationFactor = candidate?.relation === 'next_in_source' ? 0.35 : 1;
        return { candidate, score: semanticFit * relationFactor };
      })
      .sort((a, b) => b.score - a.score);
    if (!ranked.length || ranked[0].score < 0.25) return null;
    return ranked[0].candidate;
  }
}
