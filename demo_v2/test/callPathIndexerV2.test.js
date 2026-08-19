import test from 'node:test';
import assert from 'node:assert/strict';
import { CallPathIndexerV2 } from '../server/callPathIndexerV2.js';

function makeTopology() {
  const symbols = ['A','B','C','D','E','F','G','H','I','J','K'].map((name) => ({
    id: name,
    name,
    simpleName: name,
    signature: `${name}()`,
    sourcePath: `${name}.js`,
    references: []
  }));
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const edges = new Map([
    ['A', [['B', 'calls']]],
    ['B', [['C', 'calls']]],
    ['C', [['D', 'routes_to']]],
    ['D', [['E', 'calls']]],
    ['E', [['F', 'calls'], ['G', 'calls']]],
    ['H', [['I', 'calls']]],
    ['I', [['J', 'calls']]],
    ['J', [['K', 'calls']]]
  ]);
  return {
    symbols,
    symbolById: byId,
    outboundReferenceCandidates(symbol) {
      return (edges.get(symbol.id) || []).map(([target, relation]) => ({ target: byId.get(target), relation }));
    },
    resolveOutboundReference() { return []; }
  };
}

test('groups overlapping branch variants into one top candidate', () => {
  const indexer = new CallPathIndexerV2(makeTopology());
  indexer.build();
  const top = indexer.top(10);
  const branch = top.find((path) => path.signatures[0] === 'A()');
  assert.ok(branch);
  assert.equal(branch.branchVariantCount, 2);
  assert.equal(branch.alternatives.length, 1);
});

test('preserves navigation relation and renders it as a semantic boundary', () => {
  const indexer = new CallPathIndexerV2(makeTopology());
  indexer.build();
  const branch = indexer.top(10).find((path) => path.signatures[0] === 'A()');
  assert.deepEqual(branch.relations.slice(0, 4), ['calls', 'calls', 'routes_to', 'calls']);
  assert.match(indexer.render(branch), /\[NAVIGATE\]/);
});

test('keeps structurally distinct paths as separate candidates', () => {
  const indexer = new CallPathIndexerV2(makeTopology());
  indexer.build();
  const top = indexer.top(10);
  assert.ok(top.some((path) => path.signatures[0] === 'A()'));
  assert.ok(top.some((path) => path.signatures[0] === 'H()'));
});
