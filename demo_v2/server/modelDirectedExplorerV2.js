import { ModelDirectedExplorer } from './modelDirectedExplorer.js';

const arr = (value) => Array.isArray(value) ? value : [];

export class ModelDirectedExplorerV2 extends ModelDirectedExplorer {
  candidateDescriptor(candidate) {
    const descriptor = super.candidateDescriptor(candidate);
    return {
      ...descriptor,
      canGetNeighbors: !!candidate?.id && !!this.topology.symbolById?.has(candidate.id)
    };
  }

  buildPrompt(observation, candidates) {
    if (observation?.kind !== 'semantic_neighborhood') return super.buildPrompt(observation, candidates);

    const threads = this.threadSummary();
    const candidateIds = new Set((Array.isArray(candidates) ? candidates : []).map((candidate) => candidate.id));
    const rawNeighborhood = observation.canonical || {};
    const nodes = (Array.isArray(rawNeighborhood.nodes) ? rawNeighborhood.nodes : []).filter((node) => candidateIds.has(node.id));
    const visibleIds = new Set(nodes.map((node) => node.id));
    const anchorId = rawNeighborhood.anchor?.id;
    const edges = (Array.isArray(rawNeighborhood.edges) ? rawNeighborhood.edges : []).filter((edge) => (edge.from === anchorId || visibleIds.has(edge.from)) && visibleIds.has(edge.to));
    const neighborhood = { ...rawNeighborhood, nodes, edges };
    const available = (Array.isArray(candidates) ? candidates : []).map((candidate) => this.candidateDescriptor(candidate));

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

    return `MODE: NEIGHBORHOOD EVALUATION\n\nVIABLE SEMANTIC THREADS\n${JSON.stringify(threads)}\n\nCANONICAL NEIGHBORHOOD\n${JSON.stringify(neighborhood)}\n\nAVAILABLE CANDIDATES\n${JSON.stringify(available)}\n\nRETURN CONTRACT\n${JSON.stringify(contract)}\n\nRules:\n- Score only candidates listed in AVAILABLE CANDIDATES.\n- continuity/coherence are relative to the threadId you name.\n- If several candidates are plausible, score all of them; DataSong will choose the best admissible path for advance.\n- Use getArtifact when one candidate now deserves full inspection.\n- Use getNeighbors only with a candidate whose canGetNeighbors field is true.\n- Use backtrack when the local trajectory has flattened or drifted.\n- artifactId must exactly copy a supplied/known id.`;
  }

  async getSemanticUpdate(args) {
    let lastError = null;
    const neighborhood = args.observation?.kind === 'semantic_neighborhood';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry
        ? `${args.dynamicPrompt}\n\nRETRY: The previous response was rejected because: ${lastError?.message || 'validation failed'}. Return complete valid JSON matching the contract exactly and correct that error.`
        : args.dynamicPrompt;
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
}
