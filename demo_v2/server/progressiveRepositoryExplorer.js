import readline from 'node:readline/promises';
import process from 'node:process';
import { ModelDirectedExplorerV2 } from './modelDirectedExplorerV2.js';

const SINGLE_STEP = !['0', 'false', 'off', 'no'].includes(String(process.env.SINGLE_STEP || '1').trim().toLowerCase());

const SYSTEM_PROMPT = `You are DataSong's semantic navigator.

Browse the repository progressively instead of assuming every file is already a semantic function graph.

Repository browsing operations:
- listDirectory(path): inspect one directory listing;
- getArtifact(id): inspect a file or already-known semantic artifact;
- getFunction(id): inspect one source/XML/config semantic unit after the file exposes it;
- getNeighbors(id, depth 1-4): inspect lightweight call/reference topology around a selected semantic function;
- searchSemantic(query): search for canonical semantic functions relevant to a semantic question;
- advance: after scoring a neighborhood, let DataSong choose the strongest admissible path;
- backtrack: tell DataSong local semantic signal has flattened;
- stop: no useful evidence request remains.

For source files, DataSong first exposes function/method signatures only. Ask getFunction for a body. A function response includes its body and lightweight signatures for called/referenced functions.
For XML, DataSong may expose the XML content directly for now, along with addressable structured units.
For config, DataSong exposes keys/items/values progressively rather than pretending the whole file is executable code.
For documents, reason about the document as the artifact it is.

A flow is emergent: evidence belongs to a flow only when continuity and coherence sustain one concept. There is no hard structural definition of a flow.

DataSong owns repository mechanics, call graph, visited state, coverage, DFS/backtracking, cycles and caching. You choose what evidence to inspect and assess semantic fit.

Return strict JSON matching the supplied contract.`;

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 700) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }

async function waitForEnter(message) {
  if (!SINGLE_STEP || !process.stdin.isTTY || !process.stdout.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { await rl.question(message); } finally { rl.close(); }
}

export class ProgressiveRepositoryExplorer extends ModelDirectedExplorerV2 {
  isBrowseObservation(observation) {
    return ['repo_directory', 'source_file_index', 'opaque_file'].includes(observation?.kind);
  }

  isDirectFileObservation(observation) {
    return ['xml_file', 'config_file', 'text_file'].includes(observation?.kind);
  }

  buildPrompt(observation, candidates) {
    if (observation?.kind === 'repo_directory') {
      const contract = {
        evidenceRequest: {
          type: 'listDirectory|getArtifact|searchSemantic|stop',
          artifactId: 'exact file/directory id when getArtifact',
          path: 'directory path when listDirectory',
          query: 'semantic question for searchSemantic',
          reason: 'why this evidence is promising'
        }
      };
      return `MODE: REPOSITORY ORIENTATION\n\nDIRECTORY\n${JSON.stringify(observation.canonical || {})}\n\nRETURN CONTRACT\n${JSON.stringify(contract)}\n\nRules:\n- Choose what to inspect based on likely semantic signal.\n- Use listDirectory for a directory.\n- Use getArtifact for a file.\n- Do not infer a business flow merely from a file or directory name.\n- Copy ids/paths exactly from the listing.`;
    }

    if (observation?.kind === 'source_file_index') {
      const contract = {
        evidenceRequest: {
          type: 'getFunction|getArtifact|listDirectory|searchSemantic|backtrack|stop',
          artifactId: 'exact function/file id',
          path: 'directory path only for listDirectory',
          query: 'semantic question only for searchSemantic',
          reason: 'which function/evidence should be inspected next and why'
        }
      };
      return `MODE: SOURCE FILE INDEX\n\nSOURCE FILE\n${JSON.stringify(observation.canonical || {})}\n\nVIABLE SEMANTIC THREADS\n${JSON.stringify(this.threadSummary())}\n\nRETURN CONTRACT\n${JSON.stringify(contract)}\n\nRules:\n- You have signatures only, not bodies.\n- Pick a function with getFunction when its signature is promising.\n- Do not assign the file itself to a flow merely because of its filename.\n- Copy the function id exactly.`;
    }

    if (this.isDirectFileObservation(observation)) {
      const current = observation.canonical || {};
      const inventory = arr(candidates).map((candidate) => this.candidateDescriptor(candidate));
      const contract = {
        meaning: 'what this file evidence means',
        threadFits: [{ threadId: 'existing thread id', continuity: 0.0, coherence: 0.0, bridge: 'fit explanation' }],
        bestThread: 'existing thread id | NEW | UNATTACHED',
        relation: 'continue|branch|subflow|new_thread|unattached',
        placement: { type: 'after|before|between|branch_from|parallel|unknown', afterStepId: '', beforeStepId: '', branchFromStepId: '', confidence: 0.0 },
        newThread: { title: 'only when NEW', concept: 'coherent concept evidenced here' },
        semanticGain: 0.0,
        closes: 'none|branch|thread',
        openQuestion: 'optional semantic gap',
        evidenceRequest: {
          type: 'getFunction|getArtifact|getNeighbors|listDirectory|searchSemantic|backtrack|stop',
          artifactId: 'exact known id when needed',
          depth: '1-4 only for getNeighbors',
          path: 'directory path only for listDirectory',
          query: 'semantic question only for searchSemantic',
          reason: 'what evidence should be inspected next'
        }
      };
      return `MODE: DIRECT FILE EVIDENCE\n\nCURRENT FILE\n${JSON.stringify(current)}\n\nVIABLE SEMANTIC THREADS\n${JSON.stringify(this.threadSummary())}\n\nADDRESSABLE UNITS / LOCAL ARTIFACTS\n${JSON.stringify(inventory)}\n\nRETURN CONTRACT\n${JSON.stringify(contract)}\n\nRules:\n- Treat the file according to its artifact type; do not force it into a code ontology.\n- For XML, you may reason directly from the XML content and request a structured unit/function when useful.\n- For config/doc evidence, assign it to a flow only when continuity/coherence genuinely support it.\n- Copy ids exactly.`;
    }

    return super.buildPrompt(observation, candidates);
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

  validateBrowseRequest(request, observation, candidates) {
    if (!request || !['listDirectory', 'getArtifact', 'getFunction', 'getNeighbors', 'searchSemantic', 'advance', 'backtrack', 'stop'].includes(request.type)) {
      throw new Error('valid evidenceRequest.type is required');
    }
    if (request.type === 'listDirectory' && !text(request.path, 500)) throw new Error('listDirectory path is required');
    if (request.type === 'getArtifact') {
      const known = arr(candidates).some((candidate) => candidate.id === request.artifactId)
        || String(request.artifactId || '').startsWith('file:')
        || String(request.artifactId || '').startsWith('dir:')
        || this.topology.symbolById?.has(request.artifactId);
      if (!known) throw new Error('getArtifact artifactId must identify known repository evidence');
    }
    if (request.type === 'getFunction' && !this.topology.symbolById?.has(request.artifactId)) throw new Error('getFunction artifactId must identify a known function/unit');
    if (request.type === 'getNeighbors') {
      if (!this.topology.symbolById?.has(request.artifactId)) throw new Error('getNeighbors artifactId must identify a known semantic function');
      const depth = Number(request.depth || 2);
      if (!Number.isFinite(depth) || depth < 1 || depth > 4) throw new Error('getNeighbors depth must be 1-4');
    }
    if (request.type === 'searchSemantic' && !text(request.query, 300)) throw new Error('searchSemantic query is required');
  }

  async getSemanticUpdate(args) {
    const browseOnly = this.isBrowseObservation(args.observation);
    const directFile = this.isDirectFileObservation(args.observation);
    if (!browseOnly && !directFile) return super.getSemanticUpdate(args);

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${args.dynamicPrompt}\n\nRETRY: Return complete valid JSON matching the contract exactly.` : args.dynamicPrompt;
      const result = await this.callAndRecordAttempt({ dynamicPrompt: prompt, observation: args.observation, candidates: args.candidates, before: args.before, maxTokens: undefined, retry });
      try {
        const parsed = this.parseModelOutput(result.raw);
        if (browseOnly) {
          this.validateBrowseRequest(parsed.evidenceRequest, args.observation, args.candidates);
          return {
            ...result,
            parsed: {
              _navigationOnly: true,
              semanticRole: 'orientation',
              meaning: `Browsed ${args.observation.path || args.observation.id}.`,
              next: parsed.evidenceRequest
            }
          };
        }

        if (!text(parsed.meaning)) throw new Error('meaning is required');
        if (!['NEW', 'UNATTACHED', ...this.state.stories.map((story) => story.id)].includes(parsed.bestThread)) throw new Error('bestThread is invalid');
        for (const story of this.state.stories) {
          const fit = arr(parsed.threadFits).find((entry) => entry?.threadId === story.id);
          if (!fit || !Number.isFinite(Number(fit.continuity)) || !Number.isFinite(Number(fit.coherence))) throw new Error(`threadFits missing/invalid for ${story.id}`);
        }
        if (parsed.bestThread === 'NEW' && !text(parsed.newThread?.title, 160)) throw new Error('newThread.title is required for NEW');
        if (!['continue', 'branch', 'subflow', 'new_thread', 'unattached'].includes(parsed.relation)) throw new Error('relation is invalid');
        if (!parsed.placement || !Number.isFinite(Number(parsed.placement.confidence))) throw new Error('placement confidence is required');
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
    throw new Error(`No valid progressive browsing response after retry at step ${this.state.step}: ${lastError?.message || 'unknown error'}`);
  }

  applyDelta(parsed, observation) {
    if (parsed?._navigationOnly) {
      this.state.evidenceRequests.push({ step: this.state.step, ...(parsed.next || {}) });
      this.state.evidenceRequests = this.state.evidenceRequests.slice(-200);
      if (typeof this.topology.repositoryCoverageSnapshot === 'function') this.state.sourceCoverage = this.topology.repositoryCoverageSnapshot();
      return;
    }
    const result = super.applyDelta(parsed, observation);
    if (typeof this.topology.repositoryCoverageSnapshot === 'function') this.state.sourceCoverage = this.topology.repositoryCoverageSnapshot();
    return result;
  }

  async resolveNextAction(action, candidates) {
    const request = action || { type: 'stop' };
    const currentId = this._currentObservationId || '';

    if (request.type === 'listDirectory') return this.topology.listDirectory(request.path);
    if (request.type === 'getFunction') {
      this.recordTraversalEdge(currentId, request.artifactId, 'model_getFunction', 'traversed');
      return this.topology.getFunction(request.artifactId);
    }
    if (request.type === 'getArtifact') {
      this.recordTraversalEdge(currentId, request.artifactId, 'model_getArtifact', 'traversed');
      return this.topology.getArtifact(request.artifactId);
    }
    return super.resolveNextAction(request, candidates);
  }
}
