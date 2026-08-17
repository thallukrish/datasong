import { ProgressiveRepositoryTopologyV2 } from './progressiveRepositoryTopologyV2.js';

const ALLOWED_RELATIONS = new Set([
  'calls', 'routes_to', 'reads', 'writes', 'configured_by',
  'on_success', 'on_failure', 'handles', 'triggers', 'registers',
  'depends_on', 'returns_to', 'delayed_trigger', 'next_in_source'
]);

function lower(value) { return String(value || '').trim().toLowerCase(); }

export class ProgressiveRepositoryTopologyV3 extends ProgressiveRepositoryTopologyV2 {
  outboundReferenceCandidates(symbol) {
    const out = [];
    const seen = new Set();
    for (const ref of Array.isArray(symbol?.references) ? symbol.references : []) {
      const relation = String(ref?.relation || 'reference');
      if (!ALLOWED_RELATIONS.has(relation)) continue;

      const exactIds = this.nameIndex.get(lower(ref.name)) || [];
      const simpleIds = exactIds.length ? [] : (this.nameIndex.get(lower(ref.simpleName)) || []);
      const ids = [...exactIds, ...simpleIds];
      for (const id of ids) {
        const target = this.symbolById.get(id);
        if (!target || target.id === symbol.id || seen.has(`${relation}:${target.id}`)) continue;
        // next_in_source is only a local structured-source ordering edge. Never
        // allow it to hop into another file and accidentally widen a rollout.
        if (relation === 'next_in_source' && target.sourcePath !== symbol.sourcePath) continue;
        seen.add(`${relation}:${target.id}`);
        out.push({ target, relation });
      }
    }
    return out;
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

      for (const { target, relation } of this.outboundReferenceCandidates(current.symbol)) {
        edges.push({ from: current.symbol.id, to: target.id, relation });
        if (seen.has(target.id)) continue;
        seen.add(target.id);
        const packet = this.canonicalPacket(target);
        nodes.push({
          id: target.id,
          depth: current.depth + 1,
          relationFromParent: relation,
          function: target.name,
          essence: {
            kind: packet.kind,
            inputs: packet.inputs,
            outputs: packet.outputs,
            operations: packet.operations,
            conditions: packet.conditions,
            signature: target.signature,
            provenance: packet.provenance
          }
        });
        queue.push({ symbol: target, depth: current.depth + 1 });
      }
    }

    const candidates = nodes.map((node) => {
      const symbol = this.symbolById.get(node.id);
      return {
        id: symbol.id,
        path: `${symbol.sourcePath}#${symbol.name}`,
        kind: 'function',
        relation: node.relationFromParent,
        label: symbol.name,
        hint: JSON.stringify(node.essence)
      };
    });

    return {
      id: `neighborhood:${anchor.id}:d${maxDepth}`,
      path: `${anchor.sourcePath}#${anchor.name}`,
      kind: 'semantic_neighborhood',
      summary: `Outbound semantic neighborhood around ${anchor.name} to depth ${maxDepth}`,
      canonical: {
        kind: 'semantic_neighborhood',
        direction: 'outbound_only',
        anchor: this.canonicalPacket(anchor),
        depth: maxDepth,
        nodes,
        edges
      },
      neighbors: candidates,
      sourceCoverage: this.coverageFor(anchor.sourcePath)
    };
  }
}
