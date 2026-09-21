import { CanonicalSemanticTopologyV3 } from './canonicalSemanticTopologyV3.js';

function safeArray(value) { return Array.isArray(value) ? value : []; }

export class CanonicalSemanticTopologyV4 extends CanonicalSemanticTopologyV3 {
  getArtifact(id) {
    return this.observe(id);
  }

  getNeighbors(id, depth = 2) {
    const maxDepth = Math.max(1, Math.min(4, Number(depth) || 2));
    const anchor = this.symbolById.get(String(id || ''));
    if (!anchor) return null;

    const seen = new Set([anchor.id]);
    const queue = [{ symbol: anchor, depth: 0 }];
    const nodes = [];
    const edges = [];

    while (queue.length) {
      const current = queue.shift();
      if (current.depth >= maxDepth) continue;
      const neighbors = this.symbolNeighbors(current.symbol);
      for (const candidate of neighbors) {
        const target = this.symbolById.get(candidate.id);
        if (!target) continue;
        edges.push({ from: current.symbol.id, to: target.id, relation: candidate.relation || 'reference' });
        if (seen.has(target.id)) continue;
        seen.add(target.id);
        const canonical = this.canonicalCandidate(candidate);
        nodes.push({
          id: target.id,
          depth: current.depth + 1,
          relationFromParent: candidate.relation || 'reference',
          function: canonical.label,
          essence: (() => {
            try { return canonical.hint ? JSON.parse(canonical.hint) : {}; }
            catch { return { summary: String(canonical.hint || '') }; }
          })()
        });
        queue.push({ symbol: target, depth: current.depth + 1 });
      }
    }

    const candidates = nodes.map((node) => {
      const symbol = this.symbolById.get(node.id);
      return this.canonicalCandidate(this.describeCandidate(symbol, node.relationFromParent, `depth ${node.depth} from ${anchor.name}`));
    });

    return {
      id: `neighborhood:${anchor.id}:d${maxDepth}`,
      path: `${anchor.sourcePath}#${anchor.name}`,
      kind: 'semantic_neighborhood',
      summary: `Canonical neighborhood around ${anchor.name} to depth ${maxDepth}`,
      canonical: {
        kind: 'semantic_neighborhood',
        anchor: this.canonicalPacket(anchor),
        depth: maxDepth,
        nodes,
        edges
      },
      neighbors: candidates,
      sourceCoverage: this.coverageFor(anchor.sourcePath)
    };
  }

  searchSemantic(query) {
    return this.search(query);
  }

  semanticInventory(limit = 40) {
    return this.entrySymbols()
      .slice(0, Math.max(1, Number(limit) || 40))
      .map((symbol) => this.canonicalCandidate(this.describeCandidate(symbol, 'inventory', 'semantic inventory')));
  }

  neighborhoodCandidates(observation) {
    return safeArray(observation?.neighbors).map((candidate) => this.canonicalCandidate(candidate));
  }
}
