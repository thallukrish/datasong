import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OdooExecutionAdapter } from './executionAdapter.js';

function topologyStub(projectDir) {
  const symbols = [];
  return {
    repoDir: projectDir,
    cacheRoot: path.join(projectDir, 'cache'),
    trackedFiles: [],
    odooDetection: { version: '19', addons: [] },
    odooFramework: { modules: ['sale', 'sale_stock', 'stock'] },
    symbols,
    symbolById: new Map(),
    nameIndex: new Map(),
    addSemanticFunction(input) {
      const id = `${input.sourcePath}:${input.name}:${input.line}`;
      const symbol = {
        id,
        simpleName: input.name.split(/[.:/]/).at(-1),
        references: [],
        startLine: input.line,
        endLine: input.line,
        ...input
      };
      symbols.push(symbol);
      this.symbolById.set(id, symbol);
      return symbol;
    },
    reindexAllSymbols() {
      this.nameIndex = new Map();
      for (const symbol of symbols) {
        for (const key of [symbol.name, symbol.simpleName]) {
          const normalized = String(key || '').toLowerCase();
          if (!normalized) continue;
          if (!this.nameIndex.has(normalized)) this.nameIndex.set(normalized, []);
          this.nameIndex.get(normalized).push(symbol.id);
        }
      }
    },
    rebuildCallers() {}
  };
}

test('discovers an inherited Odoo implementation even when base model lookup only returns the base file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-inherit-'));
  const frameworkRoot = path.join(root, 'odoo-source');
  const saleFile = path.join(frameworkRoot, 'addons/sale/models/sale_order.py');
  const saleStockFile = path.join(frameworkRoot, 'addons/sale_stock/models/sale_order.py');
  const stockRuleFile = path.join(frameworkRoot, 'addons/stock/models/stock_rule.py');

  await fs.mkdir(path.dirname(saleFile), { recursive: true });
  await fs.mkdir(path.dirname(saleStockFile), { recursive: true });
  await fs.mkdir(path.dirname(stockRuleFile), { recursive: true });

  await fs.writeFile(saleFile, `
from odoo import models
class SaleOrder(models.Model):
    _name = 'sale.order'
    def action_confirm(self):
        return self._action_confirm()
`);

  await fs.writeFile(saleStockFile, `
from odoo import models
class SaleOrder(models.Model):
    _inherit = 'sale.order'
    def _action_confirm(self):
        self.env['stock.rule'].run([])
        return super()._action_confirm()
`);

  await fs.writeFile(stockRuleFile, `
from odoo import models
class StockRule(models.Model):
    _name = 'stock.rule'
    def run(self, procurements):
        return True
`);

  const topology = topologyStub(root);
  const modelFiles = {
    'sale.order': ['addons/sale/models/sale_order.py'],
    'stock.rule': ['addons/stock/models/stock_rule.py']
  };
  const methodFiles = {
    'sale.order.action_confirm': ['addons/sale/models/sale_order.py'],
    'sale.order._action_confirm': ['addons/sale_stock/models/sale_order.py'],
    'stock.rule.run': ['addons/stock/models/stock_rule.py']
  };

  const adapter = new OdooExecutionAdapter(topology, {
    source: {
      repoDir: frameworkRoot,
      repoUrl: 'https://github.com/odoo/odoo.git',
      commit: 'abc123'
    },
    uiEntrypoints: [{
      kind: 'object_button',
      modelName: 'sale.order',
      methodName: 'action_confirm',
      sourcePath: 'addons/sale/views/sale_order_views.xml',
      line: 10
    }],
    findModelFiles: async ({ modelName }) => modelFiles[modelName] || [],
    findMethodFiles: async ({ modelName, methodName }) => methodFiles[`${modelName}.${methodName}`] || []
  });

  const result = await adapter.augment();

  const actionConfirm = topology.symbols.find(
    (symbol) => symbol.name === 'odoo19:sale.order.action_confirm'
  );
  const inheritedConfirm = topology.symbols.find(
    (symbol) => symbol.name === 'odoo19:sale.order._action_confirm'
      && symbol.sourcePath.includes('sale_stock')
  );
  const stockRun = topology.symbols.find(
    (symbol) => symbol.name === 'odoo19:stock.rule.run'
  );

  assert.ok(actionConfirm);
  assert.ok(inheritedConfirm, 'expected sale_stock inherited _action_confirm implementation');
  assert.ok(stockRun, 'expected traversal to continue from inherited implementation');
  assert.ok(
    actionConfirm.references.some(
      (ref) => ref.relation === 'calls' && ref.name === 'odoo19:sale.order._action_confirm'
    )
  );
  assert.ok(
    inheritedConfirm.references.some(
      (ref) => ref.relation === 'calls' && ref.name === 'odoo19:stock.rule.run'
    )
  );
  assert.ok(result.frameworkMethods >= 3);
});
