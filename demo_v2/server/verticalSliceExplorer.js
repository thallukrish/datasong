import OpenAI from 'openai';
import { SemanticExplorer } from './explorer.js';

const MODEL_TIMEOUT_MS = 60_000;
const MAX_MODEL_TOKENS = Number(process.env.MAX_MODEL_TOKENS || 400);
const RETRY_MODEL_TOKENS = Number(process.env.RETRY_MODEL_TOKENS || 700);

const VERTICAL_SLICE_SYSTEM_PROMPT = `You are DataSong's semantic exploration policy.

Your objective is to discover and close one END-TO-END VERTICAL SLICE OF AN ENTERPRISE USE CASE at a time.

A vertical slice begins from a meaningful trigger, intent, request, input, schedule or event; crosses the relevant implementation/data/policy boundaries; and reaches a meaningful outcome or produced state.

Evidence has one of three roles:
- orientation: helps navigate/understand the environment but is not itself a use-case step;
- story: can be placed in an end-to-end vertical slice;
- unattached: meaningful evidence that does not currently belong to the active slice.

Never create artifact/container stories such as repository overview, configuration, tests, service layer or JMeter tests. Name a slice by the use case being accomplished, such as Customer places an order, Nightly sales aggregation, Refund approval or Price calculation.

Once a slice has been discovered, it is LOCKED. Until that slice closes, do not create or pursue another slice. Unrelated evidence is unattached/parked. Prefer evidence that extends the active slice toward its start or outcome, fills an internal gap, resolves an open branch, or establishes a required dependency contract.

Discovery order is not story order. Evidence may fit before, after, between, parallel to, or on a branch from known steps.

Prefer causal/operational continuation over source proximity. Direct calls/references are useful only when they advance the use case. Helpers, loggers and framework plumbing are usually low value.

A branch remains part of its parent slice until closed or bounded. An independently meaningful reusable process is a subflow/dependency. External source is a black box: capture only the input/output/effect contract needed by the local slice.

Return strict JSON only. Return only the requested delta. Keep every string to one short sentence.`;

function safeString(value, max = 800) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isNumberLike(value) {
  return Number.isFinite(Number(value));
}

export class VerticalSliceExplorer extends SemanticExplorer {
  emptyState() {
    const state = super.emptyState();
    state.tokenUsage.reasoning = 0;
    state.parkedDiscoveries = [];
    return state;
  }

  activeSlice() {
    return this.activeStoryId ? this.state.stories.find((story) => story.id === this.activeStoryId && story.status !== 'closed') : null;
  }

  buildPrompt(observation, candidates) {
    const active = this.activeSlice();
    const candidateDescriptors = candidates.map((candidate) => ({
      id: candidate.id,
      path: candidate.path,
      relation: candidate.relation,
      hint: safeString(candidate.hint, 120),
      locality: candidate._locality || 'global'
    }));

    const artifact = {
      id: observation.id,
      path: observation.path,
      kind: observation.kind,
      summary: observation.summary,
      excerpt: observation.excerpt || ''
    };

    if (active) {
      const slice = {
        id: active.id,
        title: active.title,
        progress: active.progress,
        steps: active.steps.slice(-12).map((step) => ({ id: step.id, meaning: step.meaning, relation: step.relation })),
        openBranches: active.branches.filter((branch) => branch.status === 'open').map((branch) => ({ id: branch.id, label: branch.label, fromStepId: branch.fromStepId })),
        openQuestions: active.openQuestions.slice(0, 6),
        dependencies: active.dependencies.slice(-6).map((dependency) => ({ label: dependency.label, scope: dependency.scope, contract: dependency.contract }))
      };

      return `ACTIVE SLICE IS LOCKED\n${JSON.stringify(slice)}\n\nOBSERVED ARTIFACT\n${JSON.stringify(artifact)}\n\nCANDIDATES\n${JSON.stringify(candidateDescriptors)}\n\nReturn ONLY this compact JSON shape:\n${JSON.stringify({
        meaning: 'short semantic statement',
        semanticRole: 'story|orientation|unattached',
        pathId: active.id,
        continuity: 0.0,
        bridge: 'how this advances the active slice',
        relation: 'continue|branch|subflow|unattached',
        placement: { type: 'after|before|between|branch_from|parallel|unknown', afterStepId: '', beforeStepId: '', branchFromStepId: '', confidence: 0.0 },
        coherenceGain: 0.0,
        closes: 'none|branch|story',
        resolvesQuestionIds: [],
        openQuestion: '',
        next: { type: 'artifact|search|stop', artifactId: '', query: '', expectedGain: 0.0 }
      })}\n\nRules:\n- Do NOT create another slice. pathId must stay ${active.id} for story evidence.\n- If this artifact belongs to another use case, return semanticRole=unattached and relation=unattached.\n- Prefer closing an existing gap/branch over novelty.\n- Choose a candidate artifact when possible; search only for a specific unresolved gap.\n- closes=story only when a meaningful start and outcome are established and all material branches are closed/bounded.`;
    }

    return `DISCOVERY MODE — find a credible vertical-slice seed; do not create a story from orientation metadata.\n\nORIENTATION\n${JSON.stringify(this.state.orientation.slice(-6))}\n\nOBSERVED ARTIFACT\n${JSON.stringify(artifact)}\n\nCANDIDATES\n${JSON.stringify(candidateDescriptors)}\n\nReturn ONLY this compact JSON shape:\n${JSON.stringify({
      meaning: 'short semantic statement',
      semanticRole: 'orientation|story|unattached',
      pathId: 'NEW|UNATTACHED',
      pathTitle: 'only for a genuine use-case seed',
      continuity: 0.0,
      bridge: 'how this evidence seeds the use case',
      relation: 'new_story|unattached',
      placement: { type: 'unknown', confidence: 0.0 },
      coherenceGain: 0.0,
      openQuestion: '',
      next: { type: 'artifact|search|stop', artifactId: '', query: '', expectedGain: 0.0 }
    })}\n\nRules:\n- Root/directories/README/build/component/ignore/framework metadata are normally orientation.\n- Only semanticRole=story may create a slice, and only when you can name an actual use case/process.\n- A test may reveal a use case, but never name the slice after the test/framework.\n- Prefer evidence likely to reveal a trigger/action/outcome chain.`;
  }

  validateSemanticDelta(parsed, locked) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.keys(parsed).length) {
      throw new Error('Empty semantic delta');
    }
    if (!['orientation', 'story', 'unattached'].includes(parsed.semanticRole)) {
      throw new Error('semanticRole is required');
    }
    if (!safeString(parsed.meaning, 500)) throw new Error('meaning is required');
    if (!parsed.next || !['artifact', 'search', 'stop'].includes(parsed.next.type)) {
      throw new Error('next action is required');
    }

    if (parsed.semanticRole === 'story') {
      if (!safeString(parsed.pathId, 120)) throw new Error('pathId is required for story evidence');
      if (locked && parsed.pathId !== locked.id) throw new Error('story evidence attempted to leave locked slice');
      if (!locked && parsed.pathId === 'NEW' && !safeString(parsed.pathTitle, 140)) throw new Error('pathTitle is required for a new slice');
      if (!['continue', 'branch', 'subflow', 'new_story'].includes(parsed.relation)) throw new Error('valid story relation is required');
      if (!isNumberLike(parsed.continuity) || !isNumberLike(parsed.coherenceGain)) throw new Error('continuity/coherenceGain are required');
      if (!parsed.placement || !isNumberLike(parsed.placement.confidence)) throw new Error('placement confidence is required');
    }

    return parsed;
  }

  async getSemanticUpdate({ dynamicPrompt, observation, candidates, before }) {
    const locked = this.activeSlice();
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry
        ? `${dynamicPrompt}\n\nRETRY: The prior response was truncated or invalid. Return COMPLETE compact JSON only. Do not add explanation.`
        : dynamicPrompt;
      const result = await this.callAndRecordAttempt({
        dynamicPrompt: prompt,
        observation,
        candidates,
        before,
        maxTokens: retry ? RETRY_MODEL_TOKENS : MAX_MODEL_TOKENS,
        retry
      });

      try {
        if (result.finishReason === 'length') throw new Error('Model hit token limit');
        const parsed = this.parseModelOutput(result.raw);
        this.validateSemanticDelta(parsed, locked);
        return { ...result, parsed };
      } catch (error) {
        lastError = error;
        await this.appendRunLog({
          type: 'llm_invalid_delta',
          call: result.callNumber,
          explorationStep: this.state.step,
          retry,
          timestamp: new Date().toISOString(),
          error: error.message,
          finishReason: result.finishReason,
          rawResponse: result.raw,
          usage: result.usage,
          cumulativeUsage: { ...this.state.tokenUsage }
        });
        this.printCallSummary(result.usage, result.callNumber, `rejected/${result.finishReason || error.message}`);
      }
    }

    throw new Error(`No valid semantic delta after retry at exploration step ${this.state.step}: ${lastError?.message || 'unknown error'}`);
  }

  applyDelta(parsed, observation) {
    const active = this.activeSlice();

    if (active && parsed.semanticRole === 'story' && parsed.pathId !== active.id) {
      const meaning = safeString(parsed.meaning, 500);
      if (meaning) {
        this.state.parkedDiscoveries.push({ artifactId: observation.id, meaning });
        this.state.parkedDiscoveries = this.state.parkedDiscoveries.slice(-40);
      }
      return super.applyDelta({ ...parsed, semanticRole: 'unattached', pathId: 'UNATTACHED', relation: 'unattached' }, observation);
    }

    return super.applyDelta(parsed, observation);
  }

  async callModel(dynamicPrompt, maxTokens = MAX_MODEL_TOKENS) {
    return this.client.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: VERTICAL_SLICE_SYSTEM_PROMPT },
        { role: 'user', content: dynamicPrompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
      // DeepSeek's Node/OpenAI-compatible API expects this at the top level.
      // Putting it under extra_body leaves V4 thinking enabled by default.
      thinking: { type: 'disabled' }
    });
  }

  accountUsage(usage) {
    const accounted = super.accountUsage(usage);
    const reasoning = Number(usage.completion_tokens_details?.reasoning_tokens || 0);
    if (!Number.isFinite(this.state.tokenUsage.reasoning)) this.state.tokenUsage.reasoning = 0;
    this.state.tokenUsage.reasoning += reasoning;
    return { ...accounted, reasoning };
  }

  printCallSummary(usage, callNumber, suffix = '') {
    const stories = this.state.stories.length
      ? this.state.stories.slice(0, 4).map((story) => `${story.title} ${story.progress}%`).join(' | ')
      : 'no slice crystallized yet';
    const reasoning = Number(usage.reasoning || 0);
    console.log(`[LLM #${callNumber}] slices: ${stories} | tokens +${usage.total} (prompt ${usage.prompt}, completion ${usage.completion}, reasoning ${reasoning}) | cumulative ${this.state.tokenUsage.total}${suffix ? ` | ${suffix}` : ''}`);
  }

  async callAndRecordAttempt({ dynamicPrompt, observation, candidates, before, maxTokens, retry }) {
    const response = await this.callModel(dynamicPrompt, maxTokens);
    const raw = response.choices?.[0]?.message?.content || '{}';
    const finishReason = response.choices?.[0]?.finish_reason || '';
    const usage = this.accountUsage(response.usage || {});
    const callNumber = ++this.modelCallCount;

    await this.appendRunLog({
      type: 'llm_attempt',
      call: callNumber,
      explorationStep: this.state.step,
      retry,
      timestamp: new Date().toISOString(),
      observedArtifact: observation,
      candidates,
      semanticBoardBefore: before,
      systemPrompt: VERTICAL_SLICE_SYSTEM_PROMPT,
      prompt: dynamicPrompt,
      rawResponse: raw,
      finishReason,
      usage,
      cumulativeUsage: { ...this.state.tokenUsage }
    });

    return { raw, usage, finishReason, callNumber, retry, promptUsed: dynamicPrompt };
  }
}
