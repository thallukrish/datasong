import { ProgressiveRepositoryExplorerV2 } from './progressiveRepositoryExplorerV2.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 700) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function cleanPath(value = '') { return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || '.'; }
function assertUnitScore(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${label} must be between 0 and 1`);
  return n;
}

function normalizeThreadChoice(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  if (parsed.bestThread === 'UNATTACHED') {
    // UNATTACHED is authoritative: the model is explicitly saying the current
    // evidence does not yet sustain a durable semantic thread. Any populated
    // newThread object is therefore contradictory decoration from the response
    // schema, not a reason to spend another model call. Discard it
    // deterministically and keep the semantic judgement as UNATTACHED.
    parsed.newThread = null;
    if (parsed.relation === 'new_thread') parsed.relation = 'unattached';
  }
  return parsed;
}

export class ProgressiveRepositoryExplorerV3 extends ProgressiveRepositoryExplorerV2 {
  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);
    if (observation?.kind === 'repo_directory') {
      return `${base}\n- Never request listDirectory for the directory already shown. Choose a child directory/file or a previewed deeper drillTarget instead.`;
    }
    if (['xml_file', 'config_file', 'text_file', 'semantic_function'].includes(observation?.kind)) {
      return `${base}\n- NEW means this evidence itself establishes a coherent concept worth pursuing as a semantic thread. Use NEW when that is true, even if no previous thread exists.\n- UNATTACHED means the evidence is not yet sufficient to sustain a coherent semantic thread. Any newThread payload is ignored when bestThread=UNATTACHED.\n- All continuity, coherence, semanticGain, expectedGain and placement confidence scores must be numbers from 0 through 1.`;
    }
    if (observation?.kind === 'semantic_neighborhood') {
      return `${base}\n- Every continuity, coherence and expectedGain score must be a number from 0 through 1.`;
    }
    return base;
  }

  validateBrowseRequest(request, observation, candidates) {
    super.validateBrowseRequest(request, observation, candidates);
    if (request?.type === 'listDirectory' && observation?.kind === 'repo_directory') {
      const requested = cleanPath(request.path);
      const current = cleanPath(observation.path || observation.canonical?.path);
      if (requested === current) throw new Error('listDirectory cannot request the directory already shown; choose a child or previewed drillTarget');
    }
  }

  validateArtifactResponse(parsed, candidates) {
    normalizeThreadChoice(parsed);
    super.validateArtifactResponse(parsed, candidates);
    for (const fit of arr(parsed.threadFits)) {
      assertUnitScore(fit.continuity, `threadFits.${fit.threadId}.continuity`);
      assertUnitScore(fit.coherence, `threadFits.${fit.threadId}.coherence`);
    }
    assertUnitScore(parsed.semanticGain, 'semanticGain');
    assertUnitScore(parsed.placement?.confidence, 'placement.confidence');
  }

  validateNeighborhoodResponse(parsed, candidates) {
    super.validateNeighborhoodResponse(parsed, candidates);
    for (const item of arr(parsed.candidateScores)) {
      assertUnitScore(item.continuity, `candidate ${item.artifactId} continuity`);
      assertUnitScore(item.coherence, `candidate ${item.artifactId} coherence`);
      assertUnitScore(item.expectedGain, `candidate ${item.artifactId} expectedGain`);
    }
  }

  async getSemanticUpdate(args) {
    // ProgressiveRepositoryExplorer handles direct XML/config/text validation
    // itself, so add the same strict score checks there while normalizing
    // contradictory schema decoration deterministically.
    const directFile = this.isDirectFileObservation(args.observation);
    if (!directFile) return super.getSemanticUpdate(args);

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${args.dynamicPrompt}\n\nRETRY: Return complete valid JSON matching the contract exactly.` : args.dynamicPrompt;
      const result = await this.callAndRecordAttempt({ dynamicPrompt: prompt, observation: args.observation, candidates: args.candidates, before: args.before, maxTokens: undefined, retry });
      try {
        const parsed = normalizeThreadChoice(this.parseModelOutput(result.raw));
        if (!text(parsed.meaning)) throw new Error('meaning is required');
        if (!['NEW', 'UNATTACHED', ...this.state.stories.map((story) => story.id)].includes(parsed.bestThread)) throw new Error('bestThread is invalid');
        for (const story of this.state.stories) {
          const fit = arr(parsed.threadFits).find((entry) => entry?.threadId === story.id);
          if (!fit) throw new Error(`threadFits missing ${story.id}`);
        }
        if (parsed.bestThread === 'NEW' && !text(parsed.newThread?.title, 160)) throw new Error('newThread.title is required for NEW');
        if (!['continue', 'branch', 'subflow', 'new_thread', 'unattached'].includes(parsed.relation)) throw new Error('relation is invalid');
        if (!parsed.placement) throw new Error('placement is required');
        for (const fit of arr(parsed.threadFits)) {
          assertUnitScore(fit.continuity, `threadFits.${fit.threadId}.continuity`);
          assertUnitScore(fit.coherence, `threadFits.${fit.threadId}.coherence`);
        }
        assertUnitScore(parsed.semanticGain, 'semanticGain');
        assertUnitScore(parsed.placement.confidence, 'placement.confidence');
        this.validateBrowseRequest(parsed.evidenceRequest, args.observation, args.candidates);
        const normalized = this.normalizeDelta({ ...parsed, next: parsed.evidenceRequest });
        normalized.next = parsed.evidenceRequest;
        return { ...result, parsed: normalized };
      } catch (error) {
        lastError = error;
        await this.appendRunLog({ type: 'llm_invalid_delta', call: result.callNumber, explorationStep: this.state.step, retry, timestamp: new Date().toISOString(), error: error.message, rawResponse: result.raw, usage: result.usage, cumulativeUsage: { ...this.state.tokenUsage } });
        this.printCallSummary(result.usage, result.callNumber, `rejected/${error.message}`);
      }
    }
    throw new Error(`No valid progressive semantic response after retry at step ${this.state.step}: ${lastError?.message || 'unknown error'}`);
  }
}
