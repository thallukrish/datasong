import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';

const MAX_STORIES_IN_PROMPT = 8;
const MAX_FRONTIERS_IN_PROMPT = 16;
const MAX_STEPS = Number(process.env.MAX_EXPLORATION_STEPS || 60);
const MODEL_TIMEOUT_MS = 60_000;
const MAX_MODEL_TOKENS = Number(process.env.MAX_MODEL_TOKENS || 1800);
const RETRY_MODEL_TOKENS = Number(process.env.RETRY_MODEL_TOKENS || Math.max(3200, MAX_MODEL_TOKENS * 2));

const SYSTEM_PROMPT = `You are the semantic exploration policy for DataSong.

You are exploring an unknown enterprise code repository. Do not assume the code represents a business workflow. It may be a workflow, ETL/data pipeline, service, algorithm, tool, policy implementation, infrastructure, or something else. Meaning must emerge from evidence.

For each observation:
1. explain what the observed artifact appears to mean semantically;
2. attach it to an existing semantic story/path if it genuinely continues one, otherwise start a new path or leave it unattached;
3. preserve all semantically material branches discovered in a story;
4. distinguish a branch from a reusable sub-flow/dependency;
5. treat source available inside the supplied repository as local evidence to explore; treat dependencies outside the supplied repository as black boxes and record only the input/output/effect contract needed by the local story;
6. update semantic closure progress. Progress may decrease when a newly discovered branch makes a story richer than previously understood;
7. choose the next artifact/action expected to maximize semantic information gain while applying completion pressure to mature unfinished stories.

A story may reach 100 only when its main progression is coherent, every important discovered branch is closed or explicitly bounded, local sub-flows have enough contract information for the parent and are separately tracked if deeper exploration remains, external dependencies have adequate black-box contracts, and no unresolved frontier could materially change the story's meaning.

Do not reward mechanical code adjacency by itself. A helper/logger/serializer can be structurally adjacent but semantically low-value.

Return strict JSON only. Keep prose compact.`;

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
      const prompt = this.buildPrompt(observation, candidates);
      const { parsed, raw, usage, finishReason, callNumber, retry } = await this.getSemanticUpdate({
        prompt,
        observation,
        candidates,
        before
      });

      this.applyUpdate(parsed, observation);

      await this.appendRunLog({
        type: 'llm_call_applied',
        call: callNumber,
        explorationStep: this.state.step,
        retry,
        timestamp: new Date().toISOString(),
        observedArtifact: observation,
        candidates,
        semanticBoardBefore: before,
        prompt,
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

      const next = await this.resolveNextAction(parsed.nextAction, candidates);
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
      narrative: story.narrative,
      branches: story.branches,
      dependencies: story.dependencies,
      unresolved: story.unresolved,
      recentGain: story.recentGain
    }));

    const shape = {
      meaning: 'compact semantic meaning of the observed artifact',
      actualGain: 0.0,
      storyUpdates: [{
        id: 'existing-id or NEW',
        title: 'story title',
        nature: 'free-form emergent description',
        narrative: 'compact current end-to-end understanding',
        progress: 0,
        status: 'early|building|closing|closed',
        recentGain: 0.0,
        branches: [{ id: 'branch-id', label: '...', status: 'open|closed|bounded', progress: 0, gap: '...' }],
        dependencies: [{ id: 'dep-id', label: '...', scope: 'local|external', contract: 'input/output/effect', storyId: 'optional local sub-flow story id' }],
        unresolved: ['specific semantic gap']
      }],
      newFragments: ['meaningful fragment that does not fit a story yet'],
      frontierScores: [{ artifactId: 'candidate id', expectedGain: 0.0, reason: '...' }],
      nextAction: { type: 'artifact|search|stop', artifactId: 'for artifact', query: 'for search', reason: 'why this maximizes gain now' },
      progressMessage: 'one short description of what was learned and what is being followed next'
    };

    return `${SYSTEM_PROMPT}\n\nCURRENT SEMANTIC BOARD\n${JSON.stringify(board)}\n\nOBSERVED ARTIFACT\n${JSON.stringify({ id: observation.id, path: observation.path, kind: observation.kind, summary: observation.summary, excerpt: observation.excerpt || '' })}\n\nAVAILABLE FRONTIERS\n${JSON.stringify(candidates)}\n\nVisited artifact ids (avoid revisiting):\n${JSON.stringify(this.state.visited.slice(-80))}\n\nReturn this JSON shape:\n${JSON.stringify(shape)}\n\nRules for nextAction:\n- Prefer an available local artifact when it can resolve the current semantic gap.\n- Use search only when the needed local evidence is not among available frontiers.\n- Do not ask to inspect external library source; capture a black-box contract instead.\n- Use stop only when no candidate/search is expected to materially improve any unfinished story.\n- frontierScores should score only candidates actually shown above.\n- Keep the total response concise. Avoid repeating unchanged story detail.`;
  }

  async getSemanticUpdate({ prompt, observation, candidates, before }) {
    const first = await this.callAndRecordAttempt({
      prompt,
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

      const retryPrompt = `${prompt}\n\nRETRY REQUIREMENT\nYour previous response was invalid or truncated JSON. Return the same semantic decision again as COMPLETE VALID JSON. Be much shorter: concise narrative, at most 8 branches, 8 dependencies, 6 unresolved gaps, and 8 frontier scores. Do not include markdown or commentary.`;
      const second = await this.callAndRecordAttempt({
        prompt: retryPrompt,
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

  async callAndRecordAttempt({ prompt, observation, candidates, before, maxTokens, retry }) {
    const response = await this.callModel(prompt, maxTokens);
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
      prompt,
      rawResponse: raw,
      finishReason,
      usage,
      cumulativeUsage: { ...this.state.tokenUsage }
    });

    return { raw, usage, finishReason, callNumber, retry };
  }

  async callModel(prompt, maxTokens = MAX_MODEL_TOKENS) {
    return this.client.chat.completions.create({
      model: this.modelName,
      messages: [{ role: 'user', content: prompt }],
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
        catch { /* preserve original context below */ }
      }
      throw new Error(`Invalid JSON: ${originalError.message}`);
    }
  }

  applyUpdate(parsed, observation) {
    for (const update of safeArray(parsed.storyUpdates)) {
      let story = update.id && update.id !== 'NEW' ? this.state.stories.find((s) => s.id === update.id) : null;
      if (!story) {
        story = { id: this.newId('story'), title: 'Emerging story', nature: '', narrative: '', progress: 0, status: 'early', branches: [], dependencies: [], unresolved: [], evidence: [], recentGain: 0 };
        this.state.stories.push(story);
      }
      story.title = safeString(update.title, 140) || story.title;
      story.nature = safeString(update.nature, 180) || story.nature;
      story.narrative = safeString(update.narrative, 1200) || story.narrative;
      story.progress = clampProgress(update.progress);
      story.status = ['early', 'building', 'closing', 'closed'].includes(update.status) ? update.status : (story.progress >= 100 ? 'closed' : story.status);
      story.recentGain = clamp01(update.recentGain ?? parsed.actualGain);
      story.branches = safeArray(update.branches).slice(0, 20).map((b, i) => ({
        id: safeString(b.id, 80) || `${story.id}-b${i + 1}`,
        label: safeString(b.label, 180),
        status: ['open', 'closed', 'bounded'].includes(b.status) ? b.status : 'open',
        progress: clampProgress(b.progress),
        gap: safeString(b.gap, 300)
      }));
      story.dependencies = safeArray(update.dependencies).slice(0, 20).map((d, i) => ({
        id: safeString(d.id, 80) || `${story.id}-d${i + 1}`,
        label: safeString(d.label, 180),
        scope: d.scope === 'external' ? 'external' : 'local',
        contract: safeString(d.contract, 500),
        storyId: safeString(d.storyId, 80)
      }));
      story.unresolved = safeArray(update.unresolved).map((x) => safeString(x, 280)).filter(Boolean).slice(0, 12);
      if (!story.evidence.includes(observation.id)) story.evidence.push(observation.id);
      if (story.progress >= 100 && (story.branches.some((b) => b.status === 'open') || story.unresolved.length)) {
        story.progress = 99;
        story.status = 'closing';
      }
    }

    for (const fragment of safeArray(parsed.newFragments)) {
      const text = safeString(fragment, 500);
      if (text && !this.state.unattachedFragments.includes(text)) this.state.unattachedFragments.push(text);
    }
    this.state.unattachedFragments = this.state.unattachedFragments.slice(-30);
    this.state.lastMessage = safeString(parsed.progressMessage, 300) || safeString(parsed.meaning, 300);
  }

  async resolveNextAction(action, candidates) {
    const type = action?.type;
    if (type === 'stop') return null;
    if (type === 'search') {
      const query = safeString(action.query, 180);
      if (!query) return this.fallbackCandidate(candidates);
      const hits = await this.topology.search(query);
      this.mergeFrontier(hits);
      return this.fallbackCandidate(hits) || this.fallbackCandidate(candidates);
    }
    if (type === 'artifact') {
      const id = safeString(action.artifactId, 500);
      const candidate = this.state.frontier.find((x) => x.id === id && !this.state.visited.includes(x.id));
      if (candidate) {
        this.removeFrontier(candidate.id);
        return this.topology.observe(candidate.id);
      }
    }
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

  printCallSummary(usage, callNumber = this.modelCallCount, note = '') {
    const stories = this.state.stories.length
      ? this.state.stories.slice(0, 6).map((s) => `${s.title} ${s.progress}%`).join(' | ')
      : 'no story crystallized yet';
    const suffix = note ? ` | ${note}` : '';
    console.log(`[LLM #${callNumber}] stories: ${stories} | tokens +${usage.total} (prompt ${usage.prompt}, completion ${usage.completion}) | cumulative ${this.state.tokenUsage.total}${suffix}`);
  }

  async startRunLog(prep) {
    const runs = path.join(this.dataRoot, 'runs');
    await fs.mkdir(runs, { recursive: true });
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    this.runLogPath = path.join(runs, `${id}.jsonl`);
    await this.appendRunLog({ type: 'run_start', timestamp: new Date().toISOString(), repoUrl: prep.repoUrl, commit: prep.commit, searchableFiles: prep.searchableFiles, model: this.modelName });
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
