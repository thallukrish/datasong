import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';

const MAX_STORIES_IN_PROMPT = 8;
const MAX_STEPS_PER_STORY_IN_PROMPT = 14;
const MAX_FRONTIERS_IN_PROMPT = 14;
const MAX_STEPS = Number(process.env.MAX_EXPLORATION_STEPS || 60);
const MODEL_TIMEOUT_MS = 60_000;
const MAX_MODEL_TOKENS = Number(process.env.MAX_MODEL_TOKENS || 1800);
const RETRY_MODEL_TOKENS = Number(process.env.RETRY_MODEL_TOKENS || Math.max(3200, MAX_MODEL_TOKENS * 2));

const SYSTEM_PROMPT = `You are the semantic interpretation and exploration policy for DataSong.

You inspect one artifact at a time from an unknown enterprise evidence world. Do not assume that an artifact belongs to a business workflow. It may represent a workflow step, ETL stage, service, algorithm, helper, policy implementation, infrastructure, data transformation, or something else.

Your job for each observed artifact is deliberately small:
1. state its semantic meaning;
2. decide whether it continues an existing semantic story, starts a new story, is a branch/sub-flow, or remains unattached;
3. if it belongs to a story, explain the semantic bridge and where it fits relative to already known steps;
4. estimate semantic continuity, placement confidence, and coherence gain;
5. choose the next local artifact/search expected to maximize information gain, while preferring closure of a mature unfinished story over unrelated novelty when gains are comparable.

Discovery order is NOT story order. A newly found artifact may belong before, after, between, parallel to, or on a branch from existing steps.

A branch is part of the current story and must remain open until explored or explicitly bounded. A reusable sub-flow should become a separately explorable story/dependency rather than being recursively inlined. Source outside the supplied repository is an external black box: describe its input/output/effect only and do not ask to inspect its implementation.

Return strict JSON only. Return only the delta for this artifact; never rewrite the whole semantic board.`;

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function clampProgress(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function safeArray(v) { return Array.isArray(v) ? v : []; }
function safeString(v, max = 800) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

export class SemanticExplorer {
  constructor({ topology, dataRoot, onState }) {
    this.topology = topology;
    this.dataRoot = dataRoot;
    this.onState = onState || (() => {});
    this.modelName = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
    this.client = process.env.DEEPSEEK_API_KEY
      ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com', timeout: MODEL_TIMEOUT_MS })
      : null;
    this.state = this.emptyState();
    this.runLogPath = null;
    this.modelCallCount = 0;
  }

  emptyState() {
    return {
      status: 'idle',
      repoUrl: '',
      commit: '',
      currentArtifact: null,
      stories: [],
      unattachedFragments: [],
      frontier: [],
      visited: [],
      step: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 },
      lastMessage: ''
    };
  }

  snapshot() { return JSON.parse(JSON.stringify(this.state)); }

  async run(repoUrl) {
    if (!this.client) throw new Error('DEEPSEEK_API_KEY is not configured');
    this.state = this.emptyState();
    this.modelCallCount = 0;
    this.state.status = 'preparing';
    this.state.repoUrl = repoUrl;
    this.emit();

    const prep = await this.topology.prepare(repoUrl);
    this.state.commit = prep.commit;
    this.state.status = 'exploring';
    this.state.currentArtifact = prep.root;
    this.state.frontier = prep.root.neighbors || [];
    await this.startRunLog(prep);
    this.emit();

    let observation = prep.root;
    for (let i = 0; i < MAX_STEPS; i += 1) {
      this.state.step = i + 1;
      this.state.currentArtifact = observation;
      if (!this.state.visited.includes(observation.id)) this.state.visited.push(observation.id);
      this.mergeFrontier(observation.neighbors || []);

      const candidates = this.activeCandidates().slice(0, MAX_FRONTIERS_IN_PROMPT);
      const before = this.snapshot();
      const dynamicPrompt = this.buildPrompt(observation, candidates);
      const { parsed, raw, usage, finishReason, callNumber, retry, promptUsed } = await this.getSemanticUpdate({
        dynamicPrompt,
        observation,
        candidates,
        before
      });

      this.applyDelta(parsed, observation);

      await this.appendRunLog({
        type: 'llm_call_applied',
        call: callNumber,
        explorationStep: this.state.step,
        retry,
        timestamp: new Date().toISOString(),
        observedArtifact: observation,
        candidates,
        semanticBoardBefore: before,
        systemPrompt: SYSTEM_PROMPT,
        prompt: promptUsed,
        rawResponse: raw,
        parsedResponse: parsed,
        finishReason,
        usage,
        cumulativeUsage: { ...this.state.tokenUsage },
        semanticBoardAfter: this.snapshot()
      });

      this.printCallSummary(usage, callNumber, retry ? 'retry applied' : 'applied');
      this.emit();

      const closed = this.state.stories.find((s) => s.progress >= 100 && s.status === 'closed');
      if (closed) {
        this.state.status = 'complete';
        this.state.lastMessage = `Closed story: ${closed.title}`;
        await this.appendRunLog({ type: 'run_complete', timestamp: new Date().toISOString(), reason: 'story_closed', story: closed, state: this.snapshot() });
        this.emit();
        return this.snapshot();
      }

      const next = await this.resolveNextAction(parsed.next, candidates);
      if (!next) {
        this.state.status = 'complete';
        this.state.lastMessage = 'No meaningful frontier remains within the current evidence boundary.';
        await this.appendRunLog({ type: 'run_complete', timestamp: new Date().toISOString(), reason: 'no_frontier', state: this.snapshot() });
        this.emit();
        return this.snapshot();
      }
      observation = next;
    }

    this.state.status = 'budget_exhausted';
    this.state.lastMessage = `Exploration stopped after ${MAX_STEPS} observations.`;
    await this.appendRunLog({ type: 'run_complete', timestamp: new Date().toISOString(), reason: 'budget_exhausted', state: this.snapshot() });
    this.emit();
    return this.snapshot();
  }

  buildPrompt(observation, candidates) {
    const board = this.state.stories.slice(0, MAX_STORIES_IN_PROMPT).map((story) => ({
      id: story.id,
      title: story.title,
      nature: story.nature,
      progress: story.progress,
      status: story.status,
      steps: story.steps.slice(-MAX_STEPS_PER_STORY_IN_PROMPT).map((step) => ({
        id: step.id,
        meaning: step.meaning,
        bridge: step.bridge,
        relation: step.relation,
        branchId: step.branchId || null
      })),
      branches: story.branches.map((b) => ({ id: b.id, label: b.label, status: b.status, progress: b.progress })),
      dependencies: story.dependencies.map((d) => ({ id: d.id, label: d.label, scope: d.scope, contract: d.contract })),
      openQuestions: story.openQuestions.slice(0, 8)
    }));

    const candidateDescriptors = candidates.map((c) => ({
      id: c.id,
      path: c.path,
      kind: c.kind,
      relation: c.relation,
      label: c.label,
      hint: safeString(c.hint, 260)
    }));

    const shape = {
      meaning: 'what this artifact means semantically',
      pathId: 'existing story id | NEW | UNATTACHED',
      pathTitle: 'only when NEW, or if an existing title should be clarified',
      pathNature: 'optional emergent type such as order flow, ETL pipeline, utility, algorithm',
      continuity: 0.0,
      bridge: 'how this artifact continues or relates to the chosen story',
      relation: 'continue|branch|subflow|new_story|unattached',
      placement: {
        type: 'after|before|between|branch_from|parallel|unknown',
        afterStepId: 'optional existing step id',
        beforeStepId: 'optional existing step id',
        branchFromStepId: 'optional existing step id',
        confidence: 0.0
      },
      coherenceGain: 0.0,
      branch: { id: 'optional branch id', label: 'optional branch label', status: 'open|closed|bounded' },
      dependency: { label: 'optional sub-flow/dependency label', scope: 'local|external', contract: 'input/output/effect if known' },
      closes: 'none|branch|story',
      openQuestion: 'optional most important semantic gap exposed by this artifact',
      next: { type: 'artifact|search|stop', artifactId: 'candidate id', query: 'search query', expectedGain: 0.0, reason: 'short reason' }
    };

    return `CURRENT SEMANTIC BOARD\n${JSON.stringify(board)}\n\nOBSERVED ARTIFACT\n${JSON.stringify({
      id: observation.id,
      path: observation.path,
      kind: observation.kind,
      summary: observation.summary,
      excerpt: observation.excerpt || ''
    })}\n\nAVAILABLE NEXT ARTIFACTS\n${JSON.stringify(candidateDescriptors)}\n\nRECENTLY VISITED IDS\n${JSON.stringify(this.state.visited.slice(-50))}\n\nReturn exactly one compact JSON object shaped like:\n${JSON.stringify(shape)}\n\nImportant:\n- pathId must refer to one existing story id, NEW, or UNATTACHED.\n- relation describes this artifact only; do not regenerate prior story state.\n- use relative placement, not absolute step numbers.\n- continuity asks whether it belongs to the story; placement.confidence asks whether its relative position is known; coherenceGain asks how much inserting it improves story coherence.\n- if this reveals a material alternative branch, set relation=branch and branch.status=open unless this artifact itself closes it.\n- use subflow only for an independently meaningful reusable local/external dependency.\n- choose next from AVAILABLE NEXT ARTIFACTS when possible; use search only if a specific semantic gap cannot be resolved locally.\n- keep the whole response very short.`;
  }

  async getSemanticUpdate({ dynamicPrompt, observation, candidates, before }) {
    const first = await this.callAndRecordAttempt({
      dynamicPrompt,
      observation,
      candidates,
      before,
      maxTokens: MAX_MODEL_TOKENS,
      retry: false
    });

    try {
      return { ...first, parsed: this.parseModelOutput(first.raw) };
    } catch (error) {
      await this.appendRunLog({
        type: 'llm_parse_error',
        call: first.callNumber,
        explorationStep: this.state.step,
        timestamp: new Date().toISOString(),
        error: error.message,
        finishReason: first.finishReason,
        rawResponse: first.raw,
        usage: first.usage,
        cumulativeUsage: { ...this.state.tokenUsage }
      });
      this.printCallSummary(first.usage, first.callNumber, `invalid JSON${first.finishReason ? `/${first.finishReason}` : ''}`);

      const retryPrompt = `${dynamicPrompt}\n\nRETRY: your previous answer was invalid JSON. Return COMPLETE VALID JSON only. Keep every string to one short sentence and omit optional branch/dependency/openQuestion fields if they are not needed.`;
      const second = await this.callAndRecordAttempt({
        dynamicPrompt: retryPrompt,
        observation,
        candidates,
        before,
        maxTokens: RETRY_MODEL_TOKENS,
        retry: true
      });

      try {
        return { ...second, parsed: this.parseModelOutput(second.raw) };
      } catch (retryError) {
        await this.appendRunLog({
          type: 'llm_parse_error',
          call: second.callNumber,
          explorationStep: this.state.step,
          timestamp: new Date().toISOString(),
          error: retryError.message,
          finishReason: second.finishReason,
          rawResponse: second.raw,
          usage: second.usage,
          cumulativeUsage: { ...this.state.tokenUsage },
          terminalForStep: true
        });
        this.printCallSummary(second.usage, second.callNumber, `invalid JSON${second.finishReason ? `/${second.finishReason}` : ''}`);
        throw new Error(`Model returned invalid JSON twice at exploration step ${this.state.step}. See ${this.runLogPath || 'data/runs/*.jsonl'} for the raw responses.`);
      }
    }
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
      systemPrompt: SYSTEM_PROMPT,
      prompt: dynamicPrompt,
      rawResponse: raw,
      finishReason,
      usage,
      cumulativeUsage: { ...this.state.tokenUsage }
    });

    return { raw, usage, finishReason, callNumber, retry, promptUsed: dynamicPrompt };
  }

  async callModel(dynamicPrompt, maxTokens = MAX_MODEL_TOKENS) {
    return this.client.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: dynamicPrompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: maxTokens
    });
  }

  parseModelOutput(raw) {
    try { return JSON.parse(raw); }
    catch (originalError) {
      const first = raw.indexOf('{');
      const last = raw.lastIndexOf('}');
      if (first >= 0 && last > first) {
        try { return JSON.parse(raw.slice(first, last + 1)); }
        catch { /* keep original error */ }
      }
      throw new Error(`Invalid JSON: ${originalError.message}`);
    }
  }

  applyDelta(parsed, observation) {
    const relation = ['continue', 'branch', 'subflow', 'new_story', 'unattached'].includes(parsed.relation)
      ? parsed.relation
      : 'unattached';
    const meaning = safeString(parsed.meaning, 500);
    const bridge = safeString(parsed.bridge, 500);
    const continuity = clamp01(parsed.continuity);
    const coherenceGain = clamp01(parsed.coherenceGain);
    const placement = this.normalizePlacement(parsed.placement);

    if (relation === 'unattached' || parsed.pathId === 'UNATTACHED') {
      if (meaning) this.state.unattachedFragments.push({ artifactId: observation.id, meaning });
      this.state.unattachedFragments = this.state.unattachedFragments.slice(-40);
      this.state.lastMessage = meaning || 'Observed an artifact that does not yet attach confidently to a story.';
      return;
    }

    let story = null;
    if (parsed.pathId && parsed.pathId !== 'NEW') story = this.state.stories.find((s) => s.id === parsed.pathId);
    if (!story) {
      story = {
        id: this.newId('story'),
        title: safeString(parsed.pathTitle, 140) || 'Emerging story',
        nature: safeString(parsed.pathNature, 180),
        status: 'early',
        progress: 0,
        steps: [],
        branches: [],
        dependencies: [],
        openQuestions: [],
        recentGain: 0,
        evidence: []
      };
      this.state.stories.push(story);
    } else {
      story.title = safeString(parsed.pathTitle, 140) || story.title;
      story.nature = safeString(parsed.pathNature, 180) || story.nature;
    }

    const step = {
      id: this.newId('step'),
      artifactId: observation.id,
      artifactPath: observation.path,
      meaning,
      bridge,
      relation,
      continuity,
      placementConfidence: placement.confidence,
      coherenceGain,
      branchId: null
    };

    if (relation === 'branch') {
      const branch = this.upsertBranch(story, parsed.branch, placement, meaning);
      step.branchId = branch.id;
      if (parsed.closes === 'branch') branch.status = 'closed';
    }

    if (relation === 'subflow') this.upsertDependency(story, parsed.dependency, meaning);

    this.insertStep(story, step, placement);
    if (!story.evidence.includes(observation.id)) story.evidence.push(observation.id);

    const question = safeString(parsed.openQuestion, 300);
    if (question && !story.openQuestions.includes(question)) story.openQuestions.push(question);
    story.openQuestions = story.openQuestions.slice(-10);

    if (parsed.closes === 'story') {
      for (const branch of story.branches) if (branch.status === 'open') branch.status = 'bounded';
      story.openQuestions = [];
      story.status = 'closed';
    }

    story.recentGain = clamp01((continuity * 0.45) + (coherenceGain * 0.35) + (placement.confidence * 0.20));
    story.progress = this.computeStoryProgress(story);
    if (story.status !== 'closed') {
      story.status = story.progress >= 85 ? 'closing' : story.progress >= 35 ? 'building' : 'early';
    }

    this.state.lastMessage = bridge || meaning || `Updated ${story.title}.`;
  }

  normalizePlacement(input) {
    const type = ['after', 'before', 'between', 'branch_from', 'parallel', 'unknown'].includes(input?.type) ? input.type : 'unknown';
    return {
      type,
      afterStepId: safeString(input?.afterStepId, 100),
      beforeStepId: safeString(input?.beforeStepId, 100),
      branchFromStepId: safeString(input?.branchFromStepId, 100),
      confidence: clamp01(input?.confidence)
    };
  }

  insertStep(story, step, placement) {
    if (!story.steps.length) {
      story.steps.push(step);
      return;
    }
    const indexOf = (id) => story.steps.findIndex((s) => s.id === id);
    const after = indexOf(placement.afterStepId);
    const before = indexOf(placement.beforeStepId);
    const branchFrom = indexOf(placement.branchFromStepId);

    if (placement.type === 'before' && before >= 0) story.steps.splice(before, 0, step);
    else if (placement.type === 'between' && after >= 0 && before >= 0 && after < before) story.steps.splice(after + 1, 0, step);
    else if (placement.type === 'after' && after >= 0) story.steps.splice(after + 1, 0, step);
    else if (placement.type === 'branch_from' && branchFrom >= 0) story.steps.splice(branchFrom + 1, 0, step);
    else story.steps.push(step);
  }

  upsertBranch(story, input, placement, meaning) {
    const requested = safeString(input?.id, 100);
    let branch = requested ? story.branches.find((b) => b.id === requested) : null;
    if (!branch) {
      branch = {
        id: requested || this.newId('branch'),
        label: safeString(input?.label, 180) || meaning || 'Discovered branch',
        status: ['open', 'closed', 'bounded'].includes(input?.status) ? input.status : 'open',
        progress: 0,
        fromStepId: placement.branchFromStepId || placement.afterStepId || ''
      };
      story.branches.push(branch);
    } else {
      branch.label = safeString(input?.label, 180) || branch.label;
      if (['open', 'closed', 'bounded'].includes(input?.status)) branch.status = input.status;
    }
    return branch;
  }

  upsertDependency(story, input, meaning) {
    const label = safeString(input?.label, 180) || meaning || 'Semantic dependency';
    const existing = story.dependencies.find((d) => d.label === label);
    if (existing) {
      existing.contract = safeString(input?.contract, 500) || existing.contract;
      existing.scope = input?.scope === 'external' ? 'external' : existing.scope;
      return existing;
    }
    const dep = {
      id: this.newId('dep'),
      label,
      scope: input?.scope === 'external' ? 'external' : 'local',
      contract: safeString(input?.contract, 500)
    };
    story.dependencies.push(dep);
    return dep;
  }

  computeStoryProgress(story) {
    if (story.status === 'closed') return 100;
    const stepCount = story.steps.length;
    if (!stepCount) return 0;

    const continuity = story.steps.reduce((sum, s) => sum + s.continuity, 0) / stepCount;
    const placement = story.steps.reduce((sum, s) => sum + s.placementConfidence, 0) / stepCount;
    const coherence = story.steps.reduce((sum, s) => sum + s.coherenceGain, 0) / stepCount;
    const baseMaturity = Math.min(75, 12 + (stepCount * 7));
    const quality = 0.45 * continuity + 0.30 * coherence + 0.25 * placement;
    let progress = baseMaturity * (0.45 + 0.55 * quality);

    const openBranches = story.branches.filter((b) => b.status === 'open').length;
    const closedBranches = story.branches.filter((b) => b.status !== 'open').length;
    if (story.branches.length) {
      const branchCoverage = closedBranches / story.branches.length;
      progress *= 0.72 + (0.28 * branchCoverage);
      progress -= openBranches * 4;
    }

    progress -= Math.min(15, story.openQuestions.length * 3);
    if (!openBranches && !story.openQuestions.length && stepCount >= 3) progress = Math.max(progress, 82);
    return clampProgress(Math.min(99, progress));
  }

  async resolveNextAction(action, candidates) {
    const type = action?.type;
    if (type === 'stop') return null;
    if (type === 'search') {
      const query = safeString(action.query, 180);
      if (!query) return this.observeFallback(candidates);
      const hits = await this.topology.search(query);
      this.mergeFrontier(hits);
      const hit = this.fallbackCandidate(hits);
      if (hit) {
        this.removeFrontier(hit.id);
        return this.topology.observe(hit.id);
      }
      return this.observeFallback(candidates);
    }
    if (type === 'artifact') {
      const id = safeString(action.artifactId, 500);
      const candidate = this.state.frontier.find((x) => x.id === id && !this.state.visited.includes(x.id));
      if (candidate) {
        this.removeFrontier(candidate.id);
        return this.topology.observe(candidate.id);
      }
    }
    return this.observeFallback(candidates);
  }

  async observeFallback(candidates) {
    const fallback = this.fallbackCandidate(candidates);
    if (!fallback) return null;
    this.removeFrontier(fallback.id);
    return this.topology.observe(fallback.id);
  }

  fallbackCandidate(candidates) {
    return safeArray(candidates).find((x) => !this.state.visited.includes(x.id)) || null;
  }

  mergeFrontier(items) {
    const known = new Set(this.state.frontier.map((x) => x.id));
    for (const item of safeArray(items)) {
      if (!item?.id || known.has(item.id) || this.state.visited.includes(item.id)) continue;
      this.state.frontier.push(item);
      known.add(item.id);
    }
    this.state.frontier = this.state.frontier.slice(-120);
  }

  activeCandidates() {
    return this.state.frontier.filter((x) => !this.state.visited.includes(x.id));
  }

  removeFrontier(id) {
    this.state.frontier = this.state.frontier.filter((x) => x.id !== id);
  }

  accountUsage(usage) {
    const prompt = Number(usage.prompt_tokens || 0);
    const completion = Number(usage.completion_tokens || 0);
    const total = Number(usage.total_tokens || prompt + completion);
    const details = usage.prompt_tokens_details || {};
    const cacheHit = Number(usage.prompt_cache_hit_tokens || details.cached_tokens || 0);
    const cacheMiss = Number(usage.prompt_cache_miss_tokens || Math.max(0, prompt - cacheHit));
    this.state.tokenUsage.prompt += prompt;
    this.state.tokenUsage.completion += completion;
    this.state.tokenUsage.total += total;
    this.state.tokenUsage.cacheHit += cacheHit;
    this.state.tokenUsage.cacheMiss += cacheMiss;
    return { prompt, completion, total, cacheHit, cacheMiss };
  }

  printCallSummary(usage, callNumber, suffix = '') {
    const stories = this.state.stories.length
      ? this.state.stories.slice(0, 6).map((s) => `${s.title} ${s.progress}%`).join(' | ')
      : 'no story crystallized yet';
    console.log(`[LLM #${callNumber}] stories: ${stories} | tokens +${usage.total} (prompt ${usage.prompt}, completion ${usage.completion}) | cumulative ${this.state.tokenUsage.total}${suffix ? ` | ${suffix}` : ''}`);
  }

  async startRunLog(prep) {
    const runs = path.join(this.dataRoot, 'runs');
    await fs.mkdir(runs, { recursive: true });
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    this.runLogPath = path.join(runs, `${id}.jsonl`);
    await this.appendRunLog({
      type: 'run_start',
      timestamp: new Date().toISOString(),
      repoUrl: prep.repoUrl,
      commit: prep.commit,
      searchableFiles: prep.searchableFiles,
      model: this.modelName,
      contract: 'compact-semantic-bridge-v2'
    });
  }

  async appendRunLog(record) {
    if (!this.runLogPath) return;
    await fs.appendFile(this.runLogPath, `${JSON.stringify(record)}\n`, 'utf8');
  }

  newId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  emit() { this.onState(this.snapshot()); }
}
