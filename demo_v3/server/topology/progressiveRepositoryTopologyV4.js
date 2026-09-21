import { ProgressiveRepositoryTopologyV3 } from './progressiveRepositoryTopologyV3.js';

function relationWeight(relation) {
  return relation === 'next_in_source' ? 0.2 : 1;
}

export class ProgressiveRepositoryTopologyV4 extends ProgressiveRepositoryTopologyV3 {
  getNeighbors(id, depth = 2) {
    const observation = super.getNeighbors(id, depth);
    if (!observation) return null;
    const anchorId = observation?.canonical?.anchor?.id || String(id || '');

    const nodes = (Array.isArray(observation.canonical?.nodes) ? observation.canonical.nodes : [])
      .filter((node) => node.id !== anchorId)
      .map((node) => ({
        ...node,
        semanticWeight: relationWeight(node.relationFromParent)
      }));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = (Array.isArray(observation.canonical?.edges) ? observation.canonical.edges : [])
      .filter((edge) => edge.to !== anchorId && (edge.from === anchorId || nodeIds.has(edge.from)) && nodeIds.has(edge.to))
      .map((edge) => ({ ...edge, semanticWeight: relationWeight(edge.relation) }));
    const neighbors = (Array.isArray(observation.neighbors) ? observation.neighbors : [])
      .filter((candidate) => candidate.id !== anchorId && nodeIds.has(candidate.id))
      .map((candidate) => ({
        ...candidate,
        semanticWeight: relationWeight(candidate.relation),
        hint: (() => {
          try {
            const parsed = candidate.hint ? JSON.parse(candidate.hint) : {};
            return JSON.stringify({ ...parsed, semanticWeight: relationWeight(candidate.relation) });
          } catch {
            return candidate.hint;
          }
        })()
      }));

    return {
      ...observation,
      canonical: {
        ...observation.canonical,
        nodes,
        edges,
        note: 'next_in_source is weak structural ordering evidence, not causal/business-flow evidence.'
      },
      neighbors
    };
  }
}
