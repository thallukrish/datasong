import { CanonicalSemanticTopology } from './canonicalSemanticTopology.js';

export class CanonicalSemanticTopologyV2 extends CanonicalSemanticTopology {
  async search(query) {
    const hits = await super.search(query).catch(async (error) => {
      // CanonicalSemanticTopology's file-redirection path is retained for
      // compatibility, but the underlying symbol topology already searches
      // semantic functions directly. Re-run the parent symbol search if an old
      // file-candidate helper name is encountered.
      if (!String(error?.message || '').includes('describeSymbolCandidate')) throw error;
      return [];
    });
    if (hits.length) return hits;

    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
    const scored = [];
    for (const symbol of this.symbols) {
      const packet = this.canonicalPacket(symbol);
      const haystack = JSON.stringify({
        function: packet.function,
        kind: packet.kind,
        inputs: packet.inputs,
        outputs: packet.outputs,
        operations: packet.operations,
        conditions: packet.conditions,
        source: packet.provenance?.source
      }).toLowerCase();
      let score = 0;
      for (const term of terms) if (haystack.includes(term)) score += 1;
      if (score > 0) scored.push({ symbol, score });
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ symbol, score }) => this.canonicalCandidate(this.describeCandidate(symbol, 'search', `canonical semantic search score ${score}`)));
  }
}
