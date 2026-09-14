import test from 'node:test';
import assert from 'node:assert/strict';
import { CallPathIndexerV3 } from '../../callPathIndexerV3.js';

test('CallPathIndexer follows qualified Odoo execution calls', () => {
  const a = { id: 'a', name: 'odoo-project:mrp.production.action_confirm', sourcePath: 'project.py', signature: 'project action_confirm', references: [] };
  const b = { id: 'b', name: 'odoo19:mrp.production.action_confirm', sourcePath: 'framework.py', signature: 'framework action_confirm', references: [] };
  const c = { id: 'c', name: 'odoo19:mrp.production._create_moves', sourcePath: 'framework.py', signature: 'framework _create_moves', references: [] };
  a.references.push({ name: b.name, relation: 'calls' });
  b.references.push({ name: c.name, relation: 'calls' });
  const symbols = [a, b, c];
  const byName = new Map(symbols.map((symbol) => [symbol.name, symbol]));
  const topology = {
    symbols,
    resolveOutboundReference(_symbol, ref) { return byName.has(ref.name) ? [byName.get(ref.name)] : []; },
    outboundReferenceCandidates(symbol) { return (symbol.references || []).map((ref) => ({ target: byName.get(ref.name), relation: ref.relation })).filter((edge) => edge.target); }
  };
  const indexer = new CallPathIndexerV3(topology);
  indexer.build();
  const path = indexer.top(1)[0];
  assert.equal(path.functionCount, 3);
  assert.deepEqual(path.relations, ['calls', 'calls']);
});
