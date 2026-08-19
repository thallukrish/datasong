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

function topologyFor(edges) {
  const ids = [...new Set([...Object.keys(edges), ...Object.values(edges).flat()])];
  const symbols = ids.map((id) => ({ id, name: id, simpleName: id, signature: `${id}()`, sourcePath: 'synthetic.js', references: [] }));
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  return {
    symbols,
    symbolById: byId,
    outboundReferenceCandidates(symbol) {
      return (edges[symbol.id] || []).map((target) => ({ target: byId.get(target), relation: 'calls' }));
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
  assert.equal(branch.alternatives[0].familyRelation, 'branch');
});

test('groups a major common suffix with at most two differing prefix nodes as alternate entrances', () => {
  const indexer = new CallPathIndexerV2(topologyFor({
    A: ['B'], B: ['C'], X: ['C'], C: ['D'], D: ['E'], E: ['F'], F: []
  }));
  indexer.build();
  const family = indexer.top(10).find((path) => path.alternateEntranceCount > 0);
  assert.ok(family);
  assert.equal(family.alternateEntranceCount, 1);
  assert.ok(family.alternatives.some((alt) => alt.familyRelation === 'alternate_entrance'));
});

test('does not merge paths when the differing entrance prefix is larger than two nodes', () => {
  const indexer = new CallPathIndexerV2(topologyFor({
    A: ['B'], B: ['C'], C: ['D'], D: ['E'],
    W: ['X'], X: ['Y'], Y: ['Z'], Z: ['D'],
    E: []
  }));
  indexer.build();
  assert.ok(indexer.top(10).length >= 2);
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
