import { ResolvedSymbolTopology } from './resolvedSymbolTopology.js';

export class BoundaryAwareTopology extends ResolvedSymbolTopology {
  async observe(idOrPath) {
    const raw = String(idOrPath || '');
    const external = this.externalById.get(raw);

    if (!external) return super.observe(idOrPath);

    // An unresolved reference is a semantic boundary, not a reason to start a
    // repository-wide search. Resume from the calling symbol's other local
    // graph edges after the boundary contract has been captured.
    const source = this.symbolById.get(external.sourceSymbolId);
    const neighbors = source
      ? this.symbolNeighbors(source)
          .filter((candidate) => candidate.id !== external.id)
          .slice(0, 12)
      : [];

    return {
      ...external,
      summary: `External/unresolved ${external.relation}: ${external.referenceName}. Treat as a black-box dependency; do not search this repository for its implementation.`,
      excerpt: '',
      sourceSymbolName: source?.name || '',
      sourcePath: source?.sourcePath || '',
      neighbors
    };
  }
}
