import { ModelDirectedExplorer } from './modelDirectedExplorer.js';

export class ModelDirectedExplorerV2 extends ModelDirectedExplorer {
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

    return `MODE: NEIGHBORHOOD EVALUATION\n\nVIABLE SEMANTIC THREADS\n${JSON.stringify(threads)}\n\nCANONICAL NEIGHBORHOOD\n${JSON.stringify(neighborhood)}\n\nAVAILABLE CANDIDATES\n${JSON.stringify(available)}\n\nRETURN CONTRACT\n${JSON.stringify(contract)}\n\nRules:\n- Score only candidates listed in AVAILABLE CANDIDATES.\n- continuity/coherence are relative to the threadId you name.\n- If several candidates are plausible, score all of them; DataSong will choose the best admissible path for advance.\n- Use getArtifact when one candidate now deserves full inspection.\n- Use getNeighbors when another bounded rollout view is needed before committing.\n- Use backtrack when the local trajectory has flattened or drifted.\n- artifactId must exactly copy a supplied/known id.`;
  }
}
