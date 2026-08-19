import test from 'node:test';
import assert from 'node:assert/strict';
import { CallPathIndexerV3 } from '../server/callPathIndexerV3.js';

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

test('dominant common prefix merges diverging tails into one branch family', () => {
  const indexer = new CallPathIndexerV3(topologyFor({
    Login: ['Actions'], Actions: ['Script'], Script: ['Existing'], Existing: ['A', 'B'], A: [], B: []
  }));
  indexer.build();
  const family = indexer.top(10).find((path) => path.signatures[0] === 'Login()');
  assert.ok(family);
  assert.equal(family.branchVariantCount, 2);
  assert.ok(family.mergedStructure);
  assert.deepEqual(family.mergedStructure.commonPrefix.slice(0, 4), ['code:login()', 'code:actions()', 'code:script()', 'code:existing()']);
  assert.equal(family.mergedStructure.branches.length, 2);
});

test('dominant common prefix with reconvergent suffix keeps suffix once', () => {
  const indexer = new CallPathIndexerV3(topologyFor({
    Login: ['Actions'], Actions: ['Script'], Script: ['Existing'], Existing: ['A', 'B'], A: ['Merge'], B: ['Merge'], Merge: []
  }));
  indexer.build();
  const family = indexer.top(10).find((path) => path.signatures[0] === 'Login()');
  assert.ok(family?.mergedStructure);
  assert.deepEqual(family.mergedStructure.commonSuffix, ['code:merge()']);
});

test('small different prefixes converging on a dominant suffix are alternate entrances', () => {
  const indexer = new CallPathIndexerV3(topologyFor({
    A: ['Core'], X: ['Core'], Core: ['Step2'], Step2: ['Step3'], Step3: ['Step4'], Step4: []
  }));
  indexer.build();
  const family = indexer.top(10).find((path) => path.alternateEntranceCount > 0);
  assert.ok(family);
  assert.equal(family.alternateEntranceCount, 1);
});

test('large distinct prefixes converging on a common suffix remain separate and expose shared subflow', () => {
  const indexer = new CallPathIndexerV3(topologyFor({
    A1: ['A2'], A2: ['A3'], A3: ['Core'],
    B1: ['B2'], B2: ['B3'], B3: ['Core'],
    Core: ['S2'], S2: ['S3'], S3: ['S4'], S4: []
  }));
  indexer.build();
  const top = indexer.top(10);
  assert.ok(top.length >= 2);
  const refs = top.flatMap((path) => path.sharedSubflowRefs || []);
  assert.ok(refs.some((ref) => (ref.sharedSuffix || []).length >= 4));
});
