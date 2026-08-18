import { ProgressiveRepositoryTopologyV6 } from './progressiveRepositoryTopologyV6.js';

function compactCandidate(topology, candidate) {
  if (!candidate?.id) return candidate;
  const symbol = topology.symbolById?.get(candidate.id);
  if (!symbol) return {
    id: candidate.id,
    path: candidate.path,
    kind: candidate.kind,
    relation: candidate.relation,
    label: candidate.label,
    hint: candidate.hint,
    ...(candidate.searchMatch ? { searchMatch: candidate.searchMatch } : {})
  };

  return {
    id: symbol.id,
    path: `${symbol.sourcePath}#${symbol.name}`,
    kind: 'function',
    relation: candidate.relation || 'reference',
    label: symbol.name,
    hint: symbol.signature || symbol.name,
    ...(candidate.searchMatch ? { searchMatch: candidate.searchMatch } : {})
  };
}

export class ProgressiveRepositoryTopologyV7 extends ProgressiveRepositoryTopologyV6 {
  async searchSemantic(query) {
    const hits = await super.searchSemantic(query);
    return (Array.isArray(hits) ? hits : []).map((candidate) => compactCandidate(this, candidate));
  }

  async search(query) {
    return this.searchSemantic(query);
  }

  getNeighbors(id, depth = 2) {
    const observation = super.getNeighbors(id, depth);
    if (!observation) return observation;

    const neighbors = (Array.isArray(observation.neighbors) ? observation.neighbors : [])
      .map((candidate) => compactCandidate(this, candidate));
    const byId = new Map(neighbors.map((candidate) => [candidate.id, candidate]));
    const raw = observation.canonical || {};
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).map((node) => {
      const candidate = byId.get(node.id);
      return {
        id: node.id,
        depth: node.depth,
        relationFromParent: node.relationFromParent,
        function: candidate?.label || node.function,
        signature: candidate?.hint || ''
      };
    });

    return {
      ...observation,
      canonical: {
        kind: 'semantic_neighborhood',
        direction: raw.direction || 'outbound_only',
        anchor: raw.anchor ? {
          id: raw.anchor.id,
          function: raw.anchor.function,
          kind: raw.anchor.kind,
          provenance: raw.anchor.provenance
        } : undefined,
        depth: raw.depth,
        nodes,
        edges: Array.isArray(raw.edges) ? raw.edges : []
      },
      neighbors
    };
  }
}
