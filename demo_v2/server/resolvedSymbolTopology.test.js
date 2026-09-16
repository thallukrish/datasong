import test from 'node:test';
import assert from 'node:assert/strict';
import { ResolvedSymbolTopology } from './resolvedSymbolTopology.js';

test('resolves an exact qualified symbol name before path heuristics', () => {
  const topology = new ResolvedSymbolTopology({ cacheRoot: 'unused' });
  const symbol = {
    id: 'framework-sale-confirm',
    name: 'odoo19:sale.order.action_confirm',
    simpleName: 'action_confirm',
    sourcePath: '@odoo19/addons/sale/models/sale_order.py',
    symbolKind: 'odoo_framework_method',
    references: []
  };

  topology.symbols = [symbol];
  topology.symbolById = new Map([[symbol.id, symbol]]);
  topology.nameIndex = new Map([
    [symbol.name.toLowerCase(), [symbol.id]],
    [symbol.simpleName.toLowerCase(), [symbol.id]]
  ]);

  const result = topology.resolveReference({
    name: 'odoo19:sale.order.action_confirm',
    simpleName: 'action_confirm',
    relation: 'calls'
  });

  assert.deepEqual(result.map((item) => item.id), [symbol.id]);
});
