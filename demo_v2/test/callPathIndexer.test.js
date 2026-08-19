import test from 'node:test';
import assert from 'node:assert/strict';
import { CallPathIndexer } from '../server/callPathIndexer.js';

function topologyFor(edges, unresolved = {}) {
  const ids = [...new Set([...Object.keys(edges), ...Object.values(edges).flat()])];
  const symbols = ids.map((id) => ({
    id,
    name: id,
    signature: `${id}()`,
    sourcePath: 'synthetic.js',
    references: (unresolved[id] || []).map((name) => ({ relation: 'calls', name }))
  }));
  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  return {
    symbols,
    symbolById,
    outboundReferenceCandidates(symbol) {
      return (edges[symbol.id] || []).map((id) => ({ relation: 'calls', target: symbolById.get(id) }));
    },
    resolveOutboundReference(symbol, ref) {
      return (edges[symbol.id] || []).includes(ref.name) ? [symbolById.get(ref.name)] : [];
    }
  };
}

test('branching produces separate longest reconstructed paths', () => {
  const indexer = new CallPathIndexer(topologyFor({ A: ['B', 'C'], B: ['D'], C: ['D'], D: [] }));
  indexer.build();
  assert.deepEqual(indexer.top(2).map((path) => path.signatures), [
    ['A()', 'B()', 'D()'],
    ['A()', 'C()', 'D()']
  ]);
});

test('cycles terminate through a path reference instead of expanding forever', () => {
  const indexer = new CallPathIndexer(topologyFor({ A: ['B'], B: ['C'], C: ['B'] }));
  indexer.build();
  const top = indexer.top(1)[0];
  assert.equal(top.functionCount, 3);
  assert.match(indexer.render(top), /REF\(P\d+\) \[cycle\]/);
});

test('unresolved outside calls terminate the reconstructed path', () => {
  const indexer = new CallPathIndexer(topologyFor({ A: [] }, { A: ['stripe.charge'] }));
  indexer.build();
  assert.match(indexer.render(indexer.top(1)[0]), /stripe\.charge\(\.\.\.\) \[external:calls\]/);
});

test('suffix subflows are retained internally but suppressed from longest-path presentation', () => {
  const indexer = new CallPathIndexer(topologyFor({ A: ['B'], B: ['C'], C: [] }));
  const snapshot = indexer.build();
  assert.equal(indexer.top(1)[0].functionCount, 3);
  assert.ok(snapshot.fragmentCount >= 3);
  assert.equal(snapshot.rankedPathCount, 1);
});
