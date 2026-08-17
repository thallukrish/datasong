import readline from 'node:readline/promises';
import process from 'node:process';
import { SemanticExplorer } from './explorer.js';
import { StackGuidedExplorer } from './stackGuidedExplorer.js';

const SINGLE_STEP = !['0', 'false', 'off', 'no'].includes(String(process.env.SINGLE_STEP || '1').trim().toLowerCase());

const SYSTEM_PROMPT = `You are DataSong's semantic interpretation and exploration policy.

DataSong has already converted heterogeneous source artifacts into canonical semantic functions. Do not reason about source syntax or ask to inspect a whole file when canonical function evidence is available.

A FLOW IS NOT A PREDEFINED STRUCTURAL TYPE. A flow emerges when a sequence or subgraph of semantic functions sustains one coherent end-to-end concept. It may be small or large and may begin anywhere. UI actions, services, data operations, configuration, events, algorithms and batch work are all merely evidence. There is no required trigger type or fixed outcome type.

For the observed canonical semantic function, evaluate semantic fit against EVERY viable thread supplied in the prompt.

For each thread return:
- continuity: how naturally this function continues the thread from its current evidence frontier;
- coherence: how well this function fits the overall story represented by the thread;
- bridge: why it belongs or does not belong.

Semantic fit dominates exploration policy. Completion/closure pressure must never pull unrelated evidence into a thread. It may matter only when more than one thread is already semantically plausible.

If no thread fits, the function may seed a new coherent thread or remain unattached. Do not invent a new thread merely because the evidence is different; create one only when the function itself supports a meaningful concept.

Mechanical call/reference adjacency tells you what is reachable, not what belongs to the same story. A structural branch may be another thread or an irrelevant implementation branch.

Return strict JSON matching the requested contract. Do not regenerate the full semantic board.`;

function text(value, max = 600) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function arr(value) { return Array.isArray(value) ? value : []; }
function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback; }

async function waitForEnter(message) {
  if (!SINGLE_STEP || !process.stdin.isTTY || !process.stdout.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { await rl.question(message); }
  finally { rl.close(); }
}

function printModelRequest(dynamicPrompt, modelName) {
  if (!SINGLE_STEP) return;
  console.log('\n============================================================');
  console.log('DATASONG SINGLE STEP — REQUEST');
  console.log('============================================================');
  console.log(`MODEL: ${modelName}`);
  console.log('\n[SYSTEM]\n');
  console.log(SYSTEM_PROMPT);
  console.log('\n[USER]\n');
  console.log(dynamicPrompt);
  console.log('============================================================');
}

function printModelResponse(response) {
  if (!SINGLE_STEP) return;
  const choice = response?.choices?.[0] || {};
  console.log('\n============================================================');
  console.log('DATASONG SINGLE STEP — RESPONSE');
  console.log('============================================================');
  console.log(`FINISH: ${choice.finish_reason || ''}`);
  console.log('\n[ASSISTANT]\n');
  console.log(choice.message?.content || '{}');
  if (response?.usage) {
    console.log('\n[USAGE]');
    console.log(JSON.stringify(response.usage, null, 2));
  }
  console.log('============================================================');
}

export class EmergentFlowExplorer extends StackGuidedExplorer {
  emptyState() {
    const state = super.emptyState();
    state.threadAssignments = [];
    state.sourceCoverage = [];
    state.trajectoryEvidence = {};
    return state;
  }

  activeSlice() {
    // There is no globally locked slice. activeStoryId is only the most recently
    // selected thread and never prevents evidence from fitting another thread.
    return null;
  }

  buildPrompt(observation, candidates) {
    const threads = this.state.stories.map((story) => ({
      id: story.id,
      title: story.title,
      status: story.status,
      narrative: story.steps.slice(-12).map((step) => ({ meaning: step.meaning, relation: step.relation })),
      openQuestions: story.openQuestions.slice(0, 6),
      branches: story.branches.map((branch) => ({ label: branch.label, status: branch.status }))
    }));

    const current = observation?.canonical || {
      id: observation?.id,
      function: observation?.symbolName || observation?.label || observation?.path,
      kind: observation?.symbolKind || observation?.kind,
      provenance: observation?.sourcePath || observation?.path
    };

    const neighbors = arr(candidates).map((candidate) => {
      let essence = {};
      try { essence = candidate.hint ? JSON.parse(candidate.hint) : {}; } catch { essence = { summary: text(candidate.hint, 220) }; }
      return {
        id: candidate.id,
        relation: candidate.relation,
        locality: candidate._locality || 'global',
        function: candidate.label,
        essence
      };
    });

    const returnShape = {
      meaning: 'semantic meaning of the current canonical function',
      threadFits: [{ threadId: 'existing thread id', continuity: 0.0, coherence: 0.0, bridge: 'fit explanation' }],
      bestThread: 'existing thread id | NEW | UNATTACHED',
      relation: 'continue | branch | subflow | new_thread | unattached',
      placement: { type: 'after|before|between|branch_from|parallel|unknown', afterStepId: '', beforeStepId: '', branchFromStepId: '', confidence: 0.0 },
      newThread: { title: 'only when bestThread=NEW', concept: 'coherent concept evidenced here' },
      semanticGain: 0.0,
      closes: 'none|branch|thread',
      openQuestion: 'optional unresolved semantic gap',
      next: { type: 'artifact|search|stop', artifactId: 'exact candidate id when artifact', query: '', expectedGain: 0.0 }
    };

    return `CURRENT CANONICAL SEMANTIC FUNCTION\n${JSON.stringify(current)}\n\nVIABLE SEMANTIC THREADS\n${JSON.stringify(threads)}\n\nCANONICAL TOPOLOGY NEIGHBORS\n${JSON.stringify(neighbors)}\n\nCURRENT SOURCE COVERAGE\n${JSON.stringify(observation?.sourceCoverage || null)}\n\nRETURN CONTRACT\n${JSON.stringify(returnShape)}\n\nRules:\n- Return one threadFits entry for every supplied thread, even when fit is low.\n- continuity is NEXT-STEP fit; coherence is OVERALL-STORY fit.\n- bestThread must be an existing thread id, NEW, or UNATTACHED.\n- Completion pressure is never a reason to assign evidence to a thread with weak continuity/coherence.\n- If several threads fit well, prefer the one for which this evidence most improves the narrative; closure pressure may be a secondary tie-breaker.\n- relation=branch only if the evidence is semantically part of that thread and represents a genuine alternate behavior in it.\n- If the current structural path has semantically drifted away, use UNATTACHED or NEW rather than forcing it into the most mature thread.\n- next.artifactId must exactly copy one supplied candidate id.\n- Search only when the needed continuation is not represented among canonical neighbors.`;
  }

  async callModel(dynamicPrompt) {
    printModelRequest(dynamicPrompt, this.modelName);
    await waitForEnter('\nPress ENTER to send this request to the model... ');

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: dynamicPrompt }],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' }
    });

    printModelResponse(response);
    await waitForEnter('\nPress ENTER to validate/apply this response and continue... ');
    return response;
  }

  validateEmergent(parsed, candidates) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('semantic response must be an object');
    if (!text(parsed.meaning)) throw new Error('meaning is required');
    if (!['NEW', 'UNATTACHED', ...this.state.stories.map((story) => story.id)].includes(parsed.bestThread)) throw new Error('bestThread is invalid');
    const fits = arr(parsed.threadFits);
    for (const story of this.state.stories) {
      const fit = fits.find((entry) => entry?.threadId === story.id);
      if (!fit) throw new Error(`threadFits missing ${story.id}`);
      if (!Number.isFinite(Number(fit.continuity)) || !Number.isFinite(Number(fit.coherence))) throw new Error(`thread fit scores missing for ${story.id}`);
    }
    if (parsed.bestThread === 'NEW' && !text(parsed.newThread?.title, 160)) throw new Error('newThread.title is required for NEW');
    if (!['continue', 'branch', 'subflow', 'new_thread', 'unattached'].includes(parsed.relation)) throw new Error('relation is invalid');
    if (!parsed.placement || !Number.isFinite(Number(parsed.placement.confidence))) throw new Error('placement confidence is required');
    if (!parsed.next || !['artifact', 'search', 'stop'].includes(parsed.next.type)) throw new Error('next is required');
    if (parsed.next.type === 'artifact' && !arr(candidates).some((candidate) => candidate.id === parsed.next.artifactId)) throw new Error('next artifactId must exactly match a supplied candidate');
  }

  normalizeDelta(parsed) {
    let semanticRole = 'unattached';
    let pathId = 'UNATTACHED';
    let pathTitle = '';
    let relation = 'unattached';
    let continuity = 0;
    let coherenceGain = number(parsed.semanticGain, 0);
    let bridge = '';

    if (parsed.bestThread === 'NEW') {
      semanticRole = 'story';
      pathId = 'NEW';
      pathTitle = text(parsed.newThread?.title, 160);
      relation = 'new_story';
      continuity = 1;
      bridge = text(parsed.newThread?.concept || parsed.meaning, 500);
    } else if (parsed.bestThread !== 'UNATTACHED') {
      const fit = arr(parsed.threadFits).find((entry) => entry?.threadId === parsed.bestThread) || {};
      semanticRole = 'story';
      pathId = parsed.bestThread;
      relation = ['continue', 'branch', 'subflow'].includes(parsed.relation) ? parsed.relation : 'continue';
      continuity = number(fit.continuity);
      coherenceGain = number(parsed.semanticGain, number(fit.coherence));
      bridge = text(fit.bridge || parsed.meaning, 500);
    }

    return {
      ...parsed,
      semanticRole,
      pathId,
      pathTitle,
      pathNature: text(parsed.newThread?.concept, 180),
      relation,
      continuity,
      coherenceGain,
      bridge,
      placement: parsed.placement,
      closes: parsed.closes === 'thread' ? 'story' : parsed.closes,
      resolvesQuestionIds: arr(parsed.resolvesQuestionIds),
      openQuestion: text(parsed.openQuestion, 300)
    };
  }

  async getSemanticUpdate(args) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${args.dynamicPrompt}\n\nRETRY: Return complete valid JSON matching the contract exactly.` : args.dynamicPrompt;
      const result = await this.callAndRecordAttempt({
        dynamicPrompt: prompt,
        observation: args.observation,
        candidates: args.candidates,
        before: args.before,
        maxTokens: undefined,
        retry
      });
      try {
        const parsed = this.parseModelOutput(result.raw);
        this.validateEmergent(parsed, args.candidates);
        return { ...result, parsed: this.normalizeDelta(parsed), emergentParsed: parsed };
      } catch (error) {
        lastError = error;
        await this.appendRunLog({
          type: 'llm_invalid_delta', call: result.callNumber, explorationStep: this.state.step, retry,
          timestamp: new Date().toISOString(), error: error.message, rawResponse: result.raw,
          usage: result.usage, cumulativeUsage: { ...this.state.tokenUsage }
        });
        this.printCallSummary(result.usage, result.callNumber, `rejected/${error.message}`);
      }
    }
    throw new Error(`No valid emergent-flow semantic delta after retry at step ${this.state.step}: ${lastError?.message || 'unknown error'}`);
  }

  applyDelta(parsed, observation) {
    const raw = parsed;
    const selectedThread = raw.pathId;
    const assignment = {
      step: this.state.step,
      artifactId: observation?.id || '',
      selectedThread,
      meaning: text(raw.meaning, 500),
      threadFits: arr(raw.threadFits).map((fit) => ({
        threadId: fit.threadId,
        continuity: number(fit.continuity),
        coherence: number(fit.coherence),
        bridge: text(fit.bridge, 300)
      }))
    };
    this.state.threadAssignments.push(assignment);
    this.state.threadAssignments = this.state.threadAssignments.slice(-200);

    // Bypass VerticalSliceExplorer's single-slice lock. SemanticExplorer owns the
    // durable story representation and can update any selected thread.
    const result = SemanticExplorer.prototype.applyDelta.call(this, raw, observation);

    const thread = raw.pathId && raw.pathId !== 'NEW' && raw.pathId !== 'UNATTACHED'
      ? this.state.stories.find((story) => story.id === raw.pathId)
      : this.state.stories.at(-1);
    if (thread && raw.semanticRole === 'story') {
      const fit = arr(raw.threadFits).find((entry) => entry?.threadId === thread.id);
      if (!this.state.trajectoryEvidence[thread.id]) this.state.trajectoryEvidence[thread.id] = [];
      this.state.trajectoryEvidence[thread.id].push({
        artifactId: observation?.id || '',
        continuity: number(fit?.continuity, raw.continuity),
        coherence: number(fit?.coherence, raw.coherenceGain),
        gain: number(raw.semanticGain, raw.coherenceGain)
      });
      this.state.trajectoryEvidence[thread.id] = this.state.trajectoryEvidence[thread.id].slice(-80);
    }

    // An unattached observation means the current structural branch has
    // semantically dampened. The next navigation step must backtrack rather than
    // continuing deeper simply because calls exist.
    this._terminateSemanticBranch = raw.semanticRole === 'unattached';
    this.state.sourceCoverage = typeof this.topology.coverageSnapshot === 'function' ? this.topology.coverageSnapshot() : [];
    return result;
  }

  async resolveNextAction(action, candidates) {
    if (this._terminateSemanticBranch) {
      this._terminateSemanticBranch = false;
      const currentId = this._currentObservationId || '';
      const frameIndex = this.state.executionStack.findIndex((frame) => frame.id === currentId);
      if (frameIndex >= 0) this.state.executionStack.splice(frameIndex, 1);
      for (let i = this.state.executionStack.length - 1; i >= 0; i -= 1) {
        const remaining = this.remainingForFrame(this.state.executionStack[i]);
        if (!remaining.length) continue;
        const candidate = remaining[0];
        this.removeFrontier(candidate.id);
        this.recordTraversalEdge(currentId, candidate.id, candidate.relation || 'semantic_backtrack', 'traversed');
        return this.topology.observe(candidate.id);
      }
      // No semantic caller continuation remains; allow normal global/thread discovery.
    }
    return super.resolveNextAction(action, candidates);
  }
}
