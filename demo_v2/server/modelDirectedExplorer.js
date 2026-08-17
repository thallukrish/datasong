import readline from 'node:readline/promises';
import process from 'node:process';
import { EmergentFlowExplorer } from './emergentFlowExplorer.js';

const SINGLE_STEP = !['0', 'false', 'off', 'no'].includes(String(process.env.SINGLE_STEP || '1').trim().toLowerCase());

const SYSTEM_PROMPT = `You are DataSong's semantic navigator and interpreter.

DataSong exposes an enterprise evidence world through canonical semantic functions. Source syntax is already normalized. You do not browse raw files. You direct information acquisition by asking DataSong for canonical evidence.

Available evidence operations are:
- getArtifact: inspect one canonical semantic function/config/object by id;
- getNeighbors: inspect a canonical topology neighborhood around an artifact, depth 1 through 4;
- searchSemantic: find canonical functions relevant to a semantic question;
- advance: after inspecting a neighborhood, ask DataSong to choose the strongest candidate using the continuity/coherence/information-gain scores you returned;
- backtrack: tell DataSong the current trajectory has flattened so it should resume another stored DFS branch;
- stop: no useful evidence request remains.

A FLOW IS NOT A PREDEFINED STRUCTURAL TYPE. It emerges whenever accumulated evidence sustains continuity and coherence around one concept, regardless of size or structural start/end type.

When inspecting a semantic artifact, evaluate its fit against every viable thread. continuity means next-step fit; coherence means overall-story fit. Semantic fit controls membership. Completion pressure never makes unrelated evidence belong to a thread.

When inspecting a neighborhood, score promising candidates rather than pretending you have inspected their full implementations. DataSong owns graph mechanics, visited state, cycles, coverage, DFS stacks, caching and branch choice. You own semantic direction and semantic scoring.

Return strict JSON matching the supplied contract.`;

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 700) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function score01(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }

async function waitForEnter(message) {
  if (!SINGLE_STEP || !process.stdin.isTTY || !process.stdout.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { await rl.question(message); } finally { rl.close(); }
}

export class ModelDirectedExplorer extends EmergentFlowExplorer {
  emptyState() {
    const state = super.emptyState();
    state.evidenceRequests = [];
    state.neighborhoodEvaluations = [];
    return state;
  }

  threadSummary() {
    return this.state.stories.map((story) => ({
      id: story.id,
      title: story.title,
      status: story.status,
      narrative: story.steps.slice(-12).map((step) => ({ meaning: step.meaning, relation: step.relation })),
      openQuestions: story.openQuestions.slice(0, 6),
      branches: story.branches.map((branch) => ({ label: branch.label, status: branch.status }))
    }));
  }

  candidateDescriptor(candidate) {
    let essence = {};
    try { essence = candidate?.hint ? JSON.parse(candidate.hint) : {}; }
    catch { essence = { summary: text(candidate?.hint, 220) }; }
    return {
      id: candidate?.id,
      relation: candidate?.relation,
      locality: candidate?._locality || 'local',
      function: candidate?.label,
      essence
    };
  }

  buildPrompt(observation, candidates) {
    const threads = this.threadSummary();
    const isNeighborhood = observation?.kind === 'semantic_neighborhood';

    if (isNeighborhood) {
      const neighborhood = observation.canonical || {};
      const available = arr(observation.neighbors).map((candidate) => this.candidateDescriptor(candidate));
      const contract = {
        candidateScores: [{
          artifactId: 'exact candidate id',
          threadId: 'existing thread id | NEW | UNATTACHED',
          continuity: 0.0,
          coherence: 0.0,
          expectedGain: 0.0,
          reason: 'why this trajectory is promising or weak'
        }],
        evidenceRequest: {
          type: 'advance|getArtifact|getNeighbors|searchSemantic|backtrack|stop',
          artifactId: 'exact known id when needed',
          depth: '1-4 only for getNeighbors',
          query: 'only for searchSemantic',
          reason: 'semantic intent'
        }
      };
      return `MODE: NEIGHBORHOOD EVALUATION\n\nVIABLE SEMANTIC THREADS\n${JSON.stringify(threads)}\n\nCANONICAL NEIGHBORHOOD\n${JSON.stringify(neighborhood)}\n\nAVAILABLE CANDIDATES\n${JSON.stringify(available)}\n\nRETURN CONTRACT\n${JSON.stringify(contract)}\n\nRules:\n- Score the candidates that are semantically useful; do not claim to know implementation details not present in their essence.\n- continuity/coherence are relative to the threadId you name.\n- If several candidates are plausible, score all of them; DataSong will choose the best admissible path for advance.\n- Use getArtifact when one candidate now deserves full inspection.\n- Use getNeighbors when another bounded rollout view is needed before committing.\n- Use backtrack when the local trajectory has flattened or drifted.\n- artifactId must exactly copy a supplied/known id.`;
    }

    const current = observation?.canonical || {
      id: observation?.id,
      function: observation?.symbolName || observation?.label || observation?.path,
      kind: observation?.symbolKind || observation?.kind,
      provenance: observation?.sourcePath || observation?.path
    };
    const inventory = arr(candidates).map((candidate) => this.candidateDescriptor(candidate));
    const contract = {
      meaning: 'semantic meaning of this canonical artifact',
      threadFits: [{ threadId: 'existing thread id', continuity: 0.0, coherence: 0.0, bridge: 'fit explanation' }],
      bestThread: 'existing thread id | NEW | UNATTACHED',
      relation: 'continue|branch|subflow|new_thread|unattached',
      placement: { type: 'after|before|between|branch_from|parallel|unknown', afterStepId: '', beforeStepId: '', branchFromStepId: '', confidence: 0.0 },
      newThread: { title: 'only when NEW', concept: 'coherent concept evidenced here' },
      semanticGain: 0.0,
      closes: 'none|branch|thread',
      openQuestion: 'optional unresolved semantic gap',
      evidenceRequest: {
        type: 'getArtifact|getNeighbors|searchSemantic|backtrack|stop',
        artifactId: 'exact known id when needed',
        depth: '1-4 only for getNeighbors',
        query: 'only for searchSemantic',
        reason: 'what semantic evidence you want next'
      }
    };

    return `MODE: ARTIFACT INTERPRETATION AND BROWSING\n\nCURRENT CANONICAL ARTIFACT\n${JSON.stringify(current)}\n\nVIABLE SEMANTIC THREADS\n${JSON.stringify(threads)}\n\nCURRENTLY KNOWN LOCAL/INVENTORY ARTIFACTS\n${JSON.stringify(inventory)}\n\nCURRENT SOURCE COVERAGE\n${JSON.stringify(observation?.sourceCoverage || null)}\n\nRETURN CONTRACT\n${JSON.stringify(contract)}\n\nRules:\n- Return one threadFits entry for every supplied thread.\n- bestThread is based on semantic continuity and coherence, never completion pressure.\n- If no thread fits, use NEW only when this evidence itself sustains a coherent concept; otherwise UNATTACHED.\n- Prefer getNeighbors(depth 2-4) when structural branching makes the promising trajectory unclear.\n- Prefer getArtifact when a known target clearly deserves full semantic inspection.\n- searchSemantic expresses a semantic question, not a raw filename/code grep.\n- backtrack means this trajectory has lost signal.\n- artifactId must exactly copy a known id.`;
  }

  async callModel(dynamicPrompt) {
    if (SINGLE_STEP) {
      console.log('\n============================================================');
      console.log('DATASONG SINGLE STEP — REQUEST');
      console.log('============================================================');
      console.log(`MODEL: ${this.modelName}`);
      console.log('\n[SYSTEM]\n');
      console.log(SYSTEM_PROMPT);
      console.log('\n[USER]\n');
      console.log(dynamicPrompt);
      console.log('============================================================');
    }
    await waitForEnter('\nPress ENTER to send this request to the model... ');
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: dynamicPrompt }],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' }
    });
    if (SINGLE_STEP) {
      console.log('\n============================================================');
      console.log('DATASONG SINGLE STEP — RESPONSE');
      console.log('============================================================');
      console.log(`FINISH: ${response?.choices?.[0]?.finish_reason || ''}`);
      console.log('\n[ASSISTANT]\n');
      console.log(response?.choices?.[0]?.message?.content || '{}');
      if (response?.usage) console.log(`\n[USAGE]\n${JSON.stringify(response.usage, null, 2)}`);
      console.log('============================================================');
    }
    await waitForEnter('\nPress ENTER to validate/apply this response and continue... ');
    return response;
  }

  validateRequest(request, candidates, neighborhood = false) {
    if (!request || !['getArtifact', 'getNeighbors', 'searchSemantic', 'advance', 'backtrack', 'stop'].includes(request.type)) throw new Error('valid evidenceRequest.type is required');
    if (request.type === 'getArtifact') {
      const known = arr(candidates).some((candidate) => candidate.id === request.artifactId) || this.topology.symbolById?.has(request.artifactId);
      if (!known) throw new Error('getArtifact artifactId must be a known canonical artifact id');
    }
    if (request.type === 'getNeighbors') {
      const known = this.topology.symbolById?.has(request.artifactId) || (!request.artifactId && !neighborhood);
      if (!known) throw new Error('getNeighbors artifactId must identify a known canonical artifact');
      const depth = Number(request.depth || 2);
      if (!Number.isFinite(depth) || depth < 1 || depth > 4) throw new Error('getNeighbors depth must be 1-4');
    }
    if (request.type === 'searchSemantic' && !text(request.query, 300)) throw new Error('searchSemantic query is required');
  }

  validateArtifactResponse(parsed, candidates) {
    if (!text(parsed.meaning)) throw new Error('meaning is required');
    if (!['NEW', 'UNATTACHED', ...this.state.stories.map((story) => story.id)].includes(parsed.bestThread)) throw new Error('bestThread is invalid');
    for (const story of this.state.stories) {
      const fit = arr(parsed.threadFits).find((entry) => entry?.threadId === story.id);
      if (!fit || !Number.isFinite(Number(fit.continuity)) || !Number.isFinite(Number(fit.coherence))) throw new Error(`threadFits missing/invalid for ${story.id}`);
    }
    if (parsed.bestThread === 'NEW' && !text(parsed.newThread?.title, 160)) throw new Error('newThread.title is required for NEW');
    if (!['continue', 'branch', 'subflow', 'new_thread', 'unattached'].includes(parsed.relation)) throw new Error('relation is invalid');
    if (!parsed.placement || !Number.isFinite(Number(parsed.placement.confidence))) throw new Error('placement confidence is required');
    this.validateRequest(parsed.evidenceRequest, candidates, false);
  }

  validateNeighborhoodResponse(parsed, candidates) {
    const ids = new Set(arr(candidates).map((candidate) => candidate.id));
    for (const item of arr(parsed.candidateScores)) {
      if (!ids.has(item?.artifactId)) throw new Error('candidateScores artifactId must exactly match a neighborhood candidate');
      if (!Number.isFinite(Number(item.continuity)) || !Number.isFinite(Number(item.coherence)) || !Number.isFinite(Number(item.expectedGain))) throw new Error('candidateScores require continuity/coherence/expectedGain');
      if (!['NEW', 'UNATTACHED', ...this.state.stories.map((story) => story.id)].includes(item.threadId)) throw new Error('candidateScores threadId is invalid');
    }
    this.validateRequest(parsed.evidenceRequest, candidates, true);
  }

  async getSemanticUpdate(args) {
    let lastError = null;
    const neighborhood = args.observation?.kind === 'semantic_neighborhood';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${args.dynamicPrompt}\n\nRETRY: Return complete valid JSON matching the contract exactly.` : args.dynamicPrompt;
      const result = await this.callAndRecordAttempt({ dynamicPrompt: prompt, observation: args.observation, candidates: args.candidates, before: args.before, maxTokens: undefined, retry });
      try {
        const parsed = this.parseModelOutput(result.raw);
        if (neighborhood) {
          this.validateNeighborhoodResponse(parsed, args.candidates);
          return {
            ...result,
            parsed: {
              _navigationOnly: true,
              candidateScores: arr(parsed.candidateScores),
              semanticRole: 'orientation',
              meaning: 'Evaluated canonical neighborhood trajectories.',
              next: { ...parsed.evidenceRequest, candidateScores: arr(parsed.candidateScores) }
            }
          };
        }
        this.validateArtifactResponse(parsed, args.candidates);
        const normalized = this.normalizeDelta({ ...parsed, next: parsed.evidenceRequest });
        normalized.next = parsed.evidenceRequest;
        return { ...result, parsed: normalized };
      } catch (error) {
        lastError = error;
        await this.appendRunLog({ type: 'llm_invalid_delta', call: result.callNumber, explorationStep: this.state.step, retry, timestamp: new Date().toISOString(), error: error.message, rawResponse: result.raw, usage: result.usage, cumulativeUsage: { ...this.state.tokenUsage } });
        this.printCallSummary(result.usage, result.callNumber, `rejected/${error.message}`);
      }
    }
    throw new Error(`No valid model-directed semantic response after retry at step ${this.state.step}: ${lastError?.message || 'unknown error'}`);
  }

  applyDelta(parsed, observation) {
    if (parsed?._navigationOnly) {
      this.state.neighborhoodEvaluations.push({ step: this.state.step, neighborhoodId: observation?.id || '', candidateScores: parsed.candidateScores || [] });
      this.state.neighborhoodEvaluations = this.state.neighborhoodEvaluations.slice(-100);
      return;
    }
    return super.applyDelta(parsed, observation);
  }

  chooseScoredCandidate(candidateScores, candidates) {
    const byId = new Map(arr(candidates).map((candidate) => [candidate.id, candidate]));
    const scored = arr(candidateScores)
      .filter((item) => byId.has(item.artifactId) && !this.state.visited.includes(item.artifactId))
      .map((item) => ({
        item,
        candidate: byId.get(item.artifactId),
        semanticFit: 0.45 * score01(item.continuity) + 0.45 * score01(item.coherence) + 0.10 * score01(item.expectedGain)
      }))
      .sort((a, b) => b.semanticFit - a.semanticFit);
    if (!scored.length) return null;
    // If the model says every local trajectory has very weak semantic fit, do
    // not force one merely because it is structurally adjacent; backtracking is safer.
    if (scored[0].semanticFit < 0.25) return null;
    return scored[0].candidate;
  }

  async backtrackFrom(currentId) {
    const index = this.state.executionStack.findIndex((frame) => frame.id === currentId);
    if (index >= 0) this.state.executionStack.splice(index, 1);
    for (let i = this.state.executionStack.length - 1; i >= 0; i -= 1) {
      const remaining = this.remainingForFrame(this.state.executionStack[i]);
      if (!remaining.length) continue;
      const candidate = remaining[0];
      this.removeFrontier(candidate.id);
      this.recordTraversalEdge(currentId, candidate.id, candidate.relation || 'semantic_backtrack', 'traversed');
      return this.topology.getArtifact(candidate.id);
    }
    const global = this.state.frontier.filter((item) => item?.id && !this.state.visited.includes(item.id)).sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a))[0];
    if (!global) return null;
    this.removeFrontier(global.id);
    return this.topology.getArtifact(global.id);
  }

  async resolveNextAction(action, candidates) {
    const request = action || { type: 'stop' };
    this.state.evidenceRequests.push({ step: this.state.step, ...request });
    this.state.evidenceRequests = this.state.evidenceRequests.slice(-200);
    const currentId = this._currentObservationId || '';

    if (request.type === 'getArtifact') {
      this.recordTraversalEdge(currentId, request.artifactId, 'model_getArtifact', 'traversed');
      this.removeFrontier(request.artifactId);
      return this.topology.getArtifact(request.artifactId);
    }

    if (request.type === 'getNeighbors') {
      const anchorId = request.artifactId || (this.topology.symbolById?.has(currentId) ? currentId : null);
      if (!anchorId) return this.backtrackFrom(currentId);
      return this.topology.getNeighbors(anchorId, Number(request.depth || 2));
    }

    if (request.type === 'searchSemantic') {
      const hits = await this.topology.searchSemantic(request.query);
      if (!hits?.length) return this.backtrackFrom(currentId);
      return {
        id: `semantic-search:${encodeURIComponent(request.query)}:${this.state.step}`,
        path: request.query,
        kind: 'semantic_neighborhood',
        summary: `Canonical semantic search results for ${request.query}`,
        canonical: { kind: 'semantic_search_results', query: request.query, nodes: hits.map((hit) => this.candidateDescriptor(hit)) },
        neighbors: hits,
        sourceCoverage: null
      };
    }

    if (request.type === 'advance') {
      const candidate = this.chooseScoredCandidate(request.candidateScores, candidates);
      if (!candidate) return this.backtrackFrom(currentId);
      this.removeFrontier(candidate.id);
      this.recordTraversalEdge(currentId, candidate.id, candidate.relation || 'semantic_advance', 'traversed');
      return this.topology.getArtifact(candidate.id);
    }

    if (request.type === 'backtrack') return this.backtrackFrom(currentId);
    if (request.type === 'stop') return this.backtrackFrom(currentId);
    return null;
  }
}
