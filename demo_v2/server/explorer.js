import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';

const MAX_STORIES_IN_PROMPT = 6;
const MAX_STEPS_PER_STORY_IN_PROMPT = 12;
const MAX_LOCAL_CANDIDATES = 10;
const MAX_GLOBAL_CANDIDATES = 4;
const MAX_STEPS = Number(process.env.MAX_EXPLORATION_STEPS || 60);
const MODEL_TIMEOUT_MS = 60_000;
const MAX_MODEL_TOKENS = Number(process.env.MAX_MODEL_TOKENS || 1000);
const RETRY_MODEL_TOKENS = Number(process.env.RETRY_MODEL_TOKENS || Math.max(1800, MAX_MODEL_TOKENS * 2));

const SYSTEM_PROMPT = `You are DataSong's semantic interpretation and exploration policy.

You inspect one artifact at a time from an unknown enterprise evidence world.

There are TWO different things you may observe:

1. ORIENTATION EVIDENCE
   Repository roots, directories, README files, build files, component descriptors, ignore files, generic framework configuration and similar artifacts may help you understand what kind of system you are in. They are NOT themselves semantic stories.

2. STORY EVIDENCE
   Code, tests, routes, service calls, queries, schemas, configuration, documents or other evidence that describes or implements an actual coherent behavior, process, transformation, algorithm, policy, data flow or other end-to-end semantic path.

Never create a story called "Repository overview", "README", "configuration", "tests", "JMeter tests", or another artifact/container name merely because that artifact was inspected. A story title must name the behavior or meaning that the evidence is revealing, for example "Customer places an order", "Nightly sales aggregation", or "Price calculation".

For each artifact return only a compact semantic delta:
- what it means;
- semanticRole = orientation | story | unattached;
- if story: which existing path it continues, or NEW;
- semantic continuity with that path;
- one semantic bridge explaining how it continues;
- where it belongs relative to known steps;
- whether it continues, branches, or exposes a reusable subflow;
- the next local artifact/search with the highest expected information gain.

Discovery order is not story order. Relative placement may be before, after, between, branch_from, parallel, or unknown.

Prefer continuing a coherent active story when a local call/service/route/entity/reference is likely to advance it. Do not wander to unrelated root metadata while a high-signal local path remains. If local semantic gain dampens, another frontier may become preferable.

A branch belongs to its parent story until closed or bounded. A reusable independently meaningful sub-flow becomes a separately explorable dependency/path. Source outside the supplied repository is a black box: record only its input/output/effect and do not request its implementation.

Return strict JSON only. Never regenerate the whole semantic board.`;

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
    this.activeStoryId = '';
  }

  emptyState() {
    return {
      status: 'idle',
      repoUrl: '',
      commit: '',
      currentArtifact: null,
      orientation: [],
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
    this.activeStoryId = '';
    this.state.status = 'preparing';
    this.state.repoUrl = repoUrl;
    this.emit();

    const prep = await this.topology.prepare(repoUrl);
    this.state.commit = prep.commit;
    this.state.status = 'exploring';
    this.state.currentArtifact = prep.root;
    this.mergeFrontier(prep.root.neighbors || []);
    await this.startRunLog(prep);
    this.emit();

    let observation = prep.root;

    for (let i = 0; i < MAX_STEPS; i += 1) {
      this.state.step = i + 1;
      this.state.currentArtifact = observation;
      if (!this.state.visited.includes(observation.id)) this.state.visited.push(observation.id);
      this.mergeFrontier(observation.neighbors || []);

      const candidates = this.candidatesFor(observation);
      const before = this.snapshot();
      const dynamicPrompt = this.buildPrompt(observation, candidates);
      const result = await this.getSemanticUpdate({ dynamicPrompt, observation, candidates, before });

      this.applyDelta(result.parsed, observation);

      await this.appendRunLog({
        type: 'llm_call_applied',
        call: result.callNumber,
        explorationStep: this.state.step,
        retry: result.retry,
        timestamp: new Date().toISOString(),
        observedArtifact: observation,
        candidates,
        semanticBoardBefore: before,
        systemPrompt: SYSTEM_PROMPT,
        prompt: result.promptUsed,
        rawResponse: result.raw,
        parsedResponse: result.parsed,
        finishReason: result.finishReason,
        usage: result.usage,
        cumulativeUsage: { ...this.state.tokenUsage },
        semanticBoardAfter: this.snapshot()
      });

      this.printCallSummary(result.usage, result.callNumber, result.retry ? 'retry applied' : 'applied');
      this.emit();

      const closed = this.state.stories.find((s) => s.progress >= 100 && s.status === 'closed');
      if (closed) {
        this.state.status = 'complete';
        this.state.lastMessage = `Closed story: ${closed.title}`;
        await this.appendRunLog({ type: 'run_complete', timestamp: new Date().toISOString(), reason: 'story_closed', story: closed, state: this.snapshot() });
        this.emit();
        return this.snapshot();
      }

      const next = await this.resolveNextAction(result.parsed.next, candidates);
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
      steps: story.steps.slice(-MAX_STEPS_PER_STORY_IN_PROMPT).map((step) => ({ id: step.id, meaning: step.meaning, bridge: step.bridge, relation: step.relation, branchId: step.branchId || null })),
      branches: story.branches.map((b) => ({ id: b.id, label: b.label, status: b.status, progress: b.progress })),
      dependencies: story.dependencies.map((d) => ({ id: d.id, label: d.label, scope: d.scope, contract: d.contract })),
      openQuestions: story.openQuestions.slice(0, 6)
    }));

    const candidateDescriptors = candidates.map((c) => ({ id: c.id, path: c.path, kind: c.kind, relation: c.relation, label: c.label, hint: safeString(c.hint, 180), locality: c._locality || 'global' }));

    const shape = {
      meaning: 'one short semantic statement',
      semanticRole: 'orientation|story|unattached',
      pathId: 'existing story id | NEW | UNATTACHED',
      pathTitle: 'only for NEW; name the behavior, never the artifact/container',
      pathNature: 'optional emergent type',
      continuity: 0.0,
      bridge: 'one short semantic bridge',
      relation: 'continue|branch|subflow|new_story|unattached',
      placement: { type: 'after|before|between|branch_from|parallel|unknown', afterStepId: 'optional', beforeStepId: 'optional', branchFromStepId: 'optional', confidence: 0.0 },
      coherenceGain: 0.0,
      branch: { id: 'optional', label: 'optional', status: 'open|closed|bounded' },
      dependency: { label: 'optional', scope: 'local|external', contract: 'optional input/output/effect' },
      closes: 'none|branch|story',
      resolvesQuestionIds: ['optional existing question ids'],
      openQuestion: 'optional next semantic gap',
      next: { type: 'artifact|search|stop', artifactId: 'candidate id', query: 'search query', expectedGain: 0.0, reason: 'short reason' }
    };

    return `ORIENTATION CONTEXT\n${JSON.stringify(this.state.orientation.slice(-8))}\n\nCURRENT SEMANTIC STORIES\n${JSON.stringify(board)}\n\nACTIVE STORY\n${JSON.stringify(this.activeStoryId || null)}\n\nOBSERVED ARTIFACT\n${JSON.stringify({ id: observation.id, path: observation.path, kind: observation.kind, summary: observation.summary, excerpt: observation.excerpt || '' })}\n\nAVAILABLE NEXT ARTIFACTS\n${JSON.stringify(candidateDescriptors)}\n\nReturn exactly one compact JSON object shaped like:\n${JSON.stringify(shape)}\n\nRules:\n- Root/directories/README/build/component/ignore/framework configuration normally have semanticRole=orientation, not story.\n- Tests may reveal a real story, but the story is the behavior under test, never \"tests\" or the test framework itself.\n- Only semanticRole=story can create or update a story.\n- pathId must be an existing story id, NEW, or UNATTACHED.\n- Prefer candidates marked locality=local when they continue a meaningful path.\n- Use relative placement, not absolute step numbers.\n- If a candidate is a direct reference/call from the current artifact, treat that structural adjacency as useful evidence but still judge semantic continuity.\n- Use search only when the required continuation is not among local candidates.\n- Keep the entire response compact.`;
  }

  candidatesFor(observation) {
    const localIds = new Set(safeArray(observation.neighbors).map((x) => x.id));
    const local = safeArray(observation.neighbors)
      .filter((x) => x?.id && !this.state.visited.includes(x.id))
      .map((x) => ({ ...x, _locality: 'local' }))
      .sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a))
      .slice(0, MAX_LOCAL_CANDIDATES);

    const chosen = new Set(local.map((x) => x.id));
    const global = this.state.frontier
      .filter((x) => x?.id && !this.state.visited.includes(x.id) && !chosen.has(x.id) && !localIds.has(x.id))
      .map((x) => ({ ...x, _locality: 'global' }))
      .sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a))
      .slice(0, MAX_GLOBAL_CANDIDATES);

    return [...local, ...global];
  }

  candidatePriority(candidate) {
    let score = 0;
    const relation = String(candidate?.relation || '');
    const p = String(candidate?.path || '').toLowerCase();
    const label = String(candidate?.label || '').toLowerCase();

    if (relation === 'reference') score += 100;
    else if (relation === 'symbol_reference') score += 95;
    else if (relation === 'search') score += 85;
    else if (relation === 'contains') score += 30;
    else if (relation === 'sibling') score += 8;

    if (candidate?.kind === 'directory') {
      score += 12;
      if (/(screen|service|src|app|route|controller|workflow|process|pipeline|api|test|script)/.test(p)) score += 28;
    }

    if (/\.(xml|js|jsx|ts|tsx|py|java|kt|sql|groovy|gradle)$/.test(p)) score += 10;
    if (/(readme|license|gitignore|package-lock|yarn\.lock|gradle\.properties|build\.gradle|pom\.xml|component\.xml)$/.test(p)) score -= 22;
    if (label.startsWith('.')) score -= 12;

    return score;
  }

  async getSemanticUpdate({ dynamicPrompt, observation, candidates, before }) {
    const first = await this.callAndRecordAttempt({ dynamicPrompt, observation, candidates, before, maxTokens: MAX_MODEL_TOKENS, retry: false });

    try {
      return { ...first, parsed: this.parseModelOutput(first.raw) };
    } catch (error) {
      await this.appendRunLog({ type: 'llm_parse_error', call: first.callNumber, explorationStep: this.state.step, timestamp: new Date().toISOString(), error: error.message, finishReason: first.finishReason, rawResponse: first.raw, usage: first.usage, cumulativeUsage: { ...this.state.tokenUsage } });
      this.printCallSummary(first.usage, first.callNumber, `invalid JSON${first.finishReason ? `/${first.finishReason}` : ''}`);

      const retryPrompt = `${dynamicPrompt}\n\nRETRY: Return COMPLETE VALID JSON only. Use very short strings and omit optional branch/dependency/openQuestion fields when unnecessary.`;
      const second = await this.callAndRecordAttempt({ dynamicPrompt: retryPrompt, observation, candidates, before, maxTokens: RETRY_MODEL_TOKENS, retry: true });

      try {
        return { ...second, parsed: this.parseModelOutput(second.raw) };
      } catch (retryError) {
        await this.appendRunLog({ type: 'llm_parse_error', call: second.callNumber, explorationStep: this.state.step, timestamp: new Date().toISOString(), error: retryError.message, finishReason: second.finishReason, rawResponse: second.raw, usage: second.usage, cumulativeUsage: { ...this.state.tokenUsage }, terminalForStep: true });
        this.printCallSummary(second.usage, second.callNumber, `invalid JSON${second.finishReason ? `/${second.finishReason}` : ''}`);
        throw new Error(`Model returned invalid JSON twice at exploration step ${this.state.step}. See ${this.runLogPath || 'data/runs/*.jsonl'} for raw responses.`);
      }
    }
  }

  async callAndRecordAttempt({ dynamicPrompt, observation, candidates, before, maxTokens, retry }) {
    const response = await this.callModel(dynamicPrompt, maxTokens);
    const raw = response.choices?.[0]?.message?.content || '{}';
    const finishReason = response.choices?.[0]?.finish_reason || '';
    const usage = this.accountUsage(response.usage || {});
    const callNumber = ++this.modelCallCount;

    await this.appendRunLog({ type: 'llm_attempt', call: callNumber, explorationStep: this.state.step, retry, timestamp: new Date().toISOString(), observedArtifact: observation, candidates, semanticBoardBefore: before, systemPrompt: SYSTEM_PROMPT, prompt: dynamicPrompt, rawResponse: raw, finishReason, usage, cumulativeUsage: { ...this.state.tokenUsage } });
    return { raw, usage, finishReason, callNumber, retry, promptUsed: dynamicPrompt };
  }

  async callModel(dynamicPrompt, maxTokens = MAX_MODEL_TOKENS) {
    return this.client.chat.completions.create({ model: this.modelName, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: dynamicPrompt }], response_format: { type: 'json_object' }, max_tokens: maxTokens });
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
    const semanticRole = ['orientation', 'story', 'unattached'].includes(parsed.semanticRole) ? parsed.semanticRole : 'unattached';
    const meaning = safeString(parsed.meaning, 500);

    if (semanticRole === 'orientation') {
      if (meaning) {
        this.state.orientation.push({ artifactId: observation.id, path: observation.path, meaning });
        this.state.orientation = this.state.orientation.slice(-24);
      }
      this.state.lastMessage = meaning || 'Added orientation context.';
      return;
    }

    if (semanticRole === 'unattached' || parsed.pathId === 'UNATTACHED') {
      if (meaning) this.state.unattachedFragments.push({ artifactId: observation.id, meaning });
      this.state.unattachedFragments = this.state.unattachedFragments.slice(-40);
      this.state.lastMessage = meaning || 'Observed evidence that does not yet attach confidently to a story.';
      return;
    }

    const relation = ['continue', 'branch', 'subflow', 'new_story'].includes(parsed.relation) ? parsed.relation : (parsed.pathId === 'NEW' ? 'new_story' : 'continue');
    const bridge = safeString(parsed.bridge, 500);
    const continuity = clamp01(parsed.continuity);
    const coherenceGain = clamp01(parsed.coherenceGain);
    const placement = this.normalizePlacement(parsed.placement);

    let story = null;
    if (parsed.pathId && parsed.pathId !== 'NEW') story = this.state.stories.find((s) => s.id === parsed.pathId);

    if (!story) {
      const title = safeString(parsed.pathTitle, 140);
      if (!title) {
        if (meaning) this.state.unattachedFragments.push({ artifactId: observation.id, meaning });
        this.state.lastMessage = meaning || 'Story-like evidence found, but no coherent path identity yet.';
        return;
      }
      story = { id: this.newId('story'), title, nature: safeString(parsed.pathNature, 180), status: 'early', progress: 0, steps: [], branches: [], dependencies: [], openQuestions: [], recentGain: 0, evidence: [] };
      this.state.stories.push(story);
    } else {
      story.title = safeString(parsed.pathTitle, 140) || story.title;
      story.nature = safeString(parsed.pathNature, 180) || story.nature;
    }

    const step = { id: this.newId('step'), artifactId: observation.id, artifactPath: observation.path, meaning, bridge, relation, continuity, placementConfidence: placement.confidence, coherenceGain, branchId: null };

    if (relation === 'branch') {
      const branch = this.upsertBranch(story, parsed.branch, placement, meaning);
      step.branchId = branch.id;
      if (parsed.closes === 'branch') branch.status = 'closed';
    }

    if (relation === 'subflow') this.upsertDependency(story, parsed.dependency, meaning);

    this.insertStep(story, step, placement);
    if (!story.evidence.includes(observation.id)) story.evidence.push(observation.id);

    const resolvedIds = new Set(safeArray(parsed.resolvesQuestionIds).map((x) => safeString(x, 100)).filter(Boolean));
    if (resolvedIds.size) story.openQuestions = story.openQuestions.filter((q) => !resolvedIds.has(q.id));

    const questionText = safeString(parsed.openQuestion, 300);
    if (questionText && !story.openQuestions.some((q) => q.text === questionText)) story.openQuestions.push({ id: this.newId('q'), text: questionText });
    story.openQuestions = story.openQuestions.slice(-8);

    if (parsed.closes === 'story' && !story.branches.some((b) => b.status === 'open')) {
      story.openQuestions = [];
      story.status = 'closed';
    }

    story.recentGain = clamp01((continuity * 0.45) + (coherenceGain * 0.35) + (placement.confidence * 0.20));
    story.progress = this.computeStoryProgress(story);
    if (story.status !== 'closed') story.status = story.progress >= 82 ? 'closing' : story.progress >= 30 ? 'building' : 'early';

    this.activeStoryId = story.id;
    this.state.lastMessage = bridge || meaning || `Updated ${story.title}.`;
  }

  normalizePlacement(input) {
    const type = ['after', 'before', 'between', 'branch_from', 'parallel', 'unknown'].includes(input?.type) ? input.type : 'unknown';
    return { type, afterStepId: safeString(input?.afterStepId, 100), beforeStepId: safeString(input?.beforeStepId, 100), branchFromStepId: safeString(input?.branchFromStepId, 100), confidence: clamp01(input?.confidence) };
  }

  insertStep(story, step, placement) {
    if (!story.steps.length) { story.steps.push(step); return; }
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
      branch = { id: requested || this.newId('branch'), label: safeString(input?.label, 180) || meaning || 'Discovered branch', status: ['open', 'closed', 'bounded'].includes(input?.status) ? input.status : 'open', progress: 0, fromStepId: placement.branchFromStepId || placement.afterStepId || '' };
      story.branches.push(branch);
    } else {
      branch.label = safeString(input?.label, 180) || branch.label;
      if (['open', 'closed', 'bounded'].includes(input?.status)) branch.status = input.status;
    }
    branch.progress = branch.status === 'closed' || branch.status === 'bounded' ? 100 : Math.max(branch.progress, 10);
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
    const dep = { id: this.newId('dep'), label, scope: input?.scope === 'external' ? 'external' : 'local', contract: safeString(input?.contract, 500) };
    story.dependencies.push(dep);
    return dep;
  }

  computeStoryProgress(story) {
    if (story.status === 'closed') return 100;
    const stepCount = story.steps.length;
    if (!stepCount) return 0;
    const avg = (key) => story.steps.reduce((sum, step) => sum + Number(step[key] || 0), 0) / stepCount;
    const quality = (0.45 * avg('continuity')) + (0.35 * avg('coherenceGain')) + (0.20 * avg('placementConfidence'));
    const maturity = 1 - Math.exp(-stepCount / 4.5);
    let progress = 88 * maturity * (0.55 + 0.45 * quality);
    const openBranches = story.branches.filter((b) => b.status === 'open').length;
    const resolvedBranches = story.branches.filter((b) => b.status !== 'open').length;
    if (story.branches.length) {
      const coverage = resolvedBranches / story.branches.length;
      progress *= 0.68 + (0.32 * coverage);
      progress -= openBranches * 5;
    }
    progress -= Math.min(18, story.openQuestions.length * 4);
    return clampProgress(Math.min(96, progress));
  }

  async resolveNextAction(action, candidates) {
    const type = action?.type;
    if (type === 'stop') return null;
    if (type === 'search') {
      const query = safeString(action.query, 180);
      if (query) {
        const hits = await this.topology.search(query);
        this.mergeFrontier(hits);
        const rankedHits = hits.filter((x) => !this.state.visited.includes(x.id)).sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a));
        const hit = rankedHits[0];
        if (hit) { this.removeFrontier(hit.id); return this.topology.observe(hit.id); }
      }
      return this.observeFallback(candidates);
    }
    if (type === 'artifact') {
      const id = safeString(action.artifactId, 500);
      const candidate = this.state.frontier.find((x) => x.id === id && !this.state.visited.includes(x.id));
      if (candidate) { this.removeFrontier(candidate.id); return this.topology.observe(candidate.id); }
    }
    return this.observeFallback(candidates);
  }

  async observeFallback(candidates) {
    const fallback = safeArray(candidates).filter((x) => !this.state.visited.includes(x.id)).sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a))[0];
    if (!fallback) return null;
    this.removeFrontier(fallback.id);
    return this.topology.observe(fallback.id);
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

  removeFrontier(id) { this.state.frontier = this.state.frontier.filter((x) => x.id !== id); }

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
    const stories = this.state.stories.length ? this.state.stories.slice(0, 6).map((s) => `${s.title} ${s.progress}%`).join(' | ') : 'no story crystallized yet';
    console.log(`[LLM #${callNumber}] stories: ${stories} | tokens +${usage.total} (prompt ${usage.prompt}, completion ${usage.completion}) | cumulative ${this.state.tokenUsage.total}${suffix ? ` | ${suffix}` : ''}`);
  }

  async startRunLog(prep) {
    const runs = path.join(this.dataRoot, 'runs');
    await fs.mkdir(runs, { recursive: true });
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    this.runLogPath = path.join(runs, `${id}.jsonl`);
    await this.appendRunLog({ type: 'run_start', timestamp: new Date().toISOString(), repoUrl: prep.repoUrl, commit: prep.commit, searchableFiles: prep.searchableFiles, model: this.modelName, contract: 'orientation-plus-semantic-bridge-v3' });
  }

  async appendRunLog(record) {
    if (!this.runLogPath) return;
    await fs.appendFile(this.runLogPath, `${JSON.stringify(record)}\n`, 'utf8');
  }

  newId(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
  emit() { this.onState(this.snapshot()); }
}
