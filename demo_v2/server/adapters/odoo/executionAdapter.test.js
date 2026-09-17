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
    trackedFiles: ['addons/acme/models/mrp_production.py'],
    odooDetection: { version: '19', addons: [{ name: 'acme', depends: ['mrp'] }] },
    odooFramework: { modules: ['base', 'mrp', 'stock'], frameworkSchemas: [] },
    symbols,
    symbolById: new Map(),
    nameIndex: new Map(),
    addSemanticFunction(input) {
      const id = `${input.sourcePath}:${input.name}:${input.line}`;
      const symbol = { id, simpleName: input.name.split(/[.:/]/).at(-1), references: [], startLine: input.line, endLine: input.line, ...input };
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

test('bridges a project super call into targeted Odoo framework methods with structural evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-exec-'));
  const projectFile = path.join(root, 'addons/acme/models/mrp_production.py');
  const frameworkRoot = path.join(root, 'odoo-source');
  const frameworkFile = path.join(frameworkRoot, 'addons/mrp/models/mrp_production.py');
  await fs.mkdir(path.dirname(projectFile), { recursive: true });
  await fs.mkdir(path.dirname(frameworkFile), { recursive: true });

  await fs.writeFile(projectFile, `
from odoo import models
class MrpProduction(models.Model):
    _inherit = 'mrp.production'
    def action_confirm(self):
        result = super().action_confirm()
        self.env.cr.execute("UPDATE mrp_production SET state = 'progress'")
        return result
`);
  await fs.writeFile(frameworkFile, `
from odoo import models
class MrpProduction(models.Model):
    _name = 'mrp.production'
    def action_confirm(self):
        self._create_moves()
    def _create_moves(self):
        self.env['stock.move'].create({})
`);

  const topology = topologyStub(root);
  const adapter = new OdooExecutionAdapter(topology, {
    source: { repoDir: frameworkRoot, repoUrl: 'https://github.com/odoo/odoo.git', commit: 'abc123' },
    findModelFiles: async ({ modelName }) => modelName === 'mrp.production' ? ['addons/mrp/models/mrp_production.py'] : [],
    findUiFiles: async () => []
  });
  const result = await adapter.augment();

  assert.equal(result.bridgedSuperCalls, 1);
  const project = topology.symbols.find((symbol) => symbol.name === 'odoo-project:mrp.production.action_confirm');
  const base = topology.symbols.find((symbol) => symbol.name === 'odoo19:mrp.production.action_confirm');
  const createMoves = topology.symbols.find((symbol) => symbol.name === 'odoo19:mrp.production._create_moves');
  assert.equal(project.odooExecution.firstClassEntity, true);
  assert.equal(project.odooExecution.firstClassMethod, true);
  assert.equal(base.odooExecution.firstClassMethod, true);
  const superRef = project.references.find((ref) => ref.relation === 'calls' && ref.name === base.name);
  assert.equal(superRef.data.boundaryKind, 'same_model');
  assert.ok(base.references.some((ref) => ref.relation === 'calls' && ref.name === createMoves.name && ref.data.boundaryKind === 'same_model'));
  assert.ok(createMoves.references.some((ref) => ref.relation === 'writes' && ref.name === 'stock.move' && ref.data.crud === 'create' && ref.data.logicalEntity === 'stock.move'));
  assert.ok(project.references.some((ref) => ref.relation === 'writes' && ref.name === 'mrp_production' && ref.data.persistenceKind === 'sql' && ref.data.crud === 'update'));
  assert.ok(result.structuralStats.ormCreates >= 1);
  assert.ok(result.structuralStats.sqlUpdates >= 1);
});

test('uses Odoo UI object-button entrypoints as targeted framework seeds', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-ui-seed-'));
  const frameworkRoot = path.join(root, 'odoo-source');
  const frameworkFile = path.join(frameworkRoot, 'addons/sale/models/sale_order.py');
  await fs.mkdir(path.dirname(frameworkFile), { recursive: true });
  await fs.writeFile(frameworkFile, `
from odoo import models
class SaleOrder(models.Model):
    _name = 'sale.order'
    def action_confirm(self):
        self.with_context(skip_check=True)._action_confirm()
    def _action_confirm(self):
        return True
`);

  const topology = topologyStub(root);
  topology.trackedFiles = [];
  topology.odooFramework.modules = ['sale'];

  const adapter = new OdooExecutionAdapter(topology, {
    source: { repoDir: frameworkRoot, repoUrl: 'https://github.com/odoo/odoo.git', commit: 'abc123' },
    uiEntrypoints: [{
      kind: 'object_button', modelName: 'sale.order', methodName: 'action_confirm',
      sourcePath: 'addons/sale/views/sale_order_views.xml', line: 10
    }],
    findModelFiles: async ({ modelName }) => modelName === 'sale.order' ? ['addons/sale/models/sale_order.py'] : [],
    findUiFiles: async () => []
  });

  const result = await adapter.augment();
  assert.equal(result.uiEntrypointSeeds, 1);
  const confirm = topology.symbols.find((symbol) => symbol.name === 'odoo19:sale.order.action_confirm');
  const actionConfirm = topology.symbols.find((symbol) => symbol.name === 'odoo19:sale.order._action_confirm');
  assert.ok(confirm);
  assert.ok(actionConfirm);
  assert.ok(confirm.references.some((ref) => ref.relation === 'calls' && ref.name === actionConfirm.name && ref.data.boundaryKind === 'same_model'));
  assert.equal(result.unresolvedCalls.includes('sale.order.with_context'), false);
});

test('discovers framework object-button XML as execution seeds for relevant framework models', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-framework-ui-seed-'));
  const frameworkRoot = path.join(root, 'odoo-source');
  const modelFile = path.join(frameworkRoot, 'addons/sale/models/sale_order.py');
  const viewFile = path.join(frameworkRoot, 'addons/sale/views/sale_order_views.xml');
  await fs.mkdir(path.dirname(modelFile), { recursive: true });
  await fs.mkdir(path.dirname(viewFile), { recursive: true });
  await fs.writeFile(modelFile, `
from odoo import models
class SaleOrder(models.Model):
    _name = 'sale.order'
    def action_confirm(self):
        self._action_confirm()
    def _action_confirm(self):
        return True
`);
  await fs.writeFile(viewFile, `<odoo>
    <record id="view_order_form" model="ir.ui.view">
      <field name="model">sale.order</field>
      <field name="arch" type="xml">
        <form><header><button name="action_confirm" type="object" string="Confirm"/></header></form>
      </field>
    </record>
  </odoo>`);

  const topology = topologyStub(root);
  topology.trackedFiles = [];
  topology.odooFramework = {
    modules: ['sale'],
    frameworkSchemas: [{ name: 'sale.order', ownership: 'framework' }]
  };

  const adapter = new OdooExecutionAdapter(topology, {
    source: { repoDir: frameworkRoot, repoUrl: 'https://github.com/odoo/odoo.git', commit: 'abc123' },
    findModelFiles: async ({ modelName }) => modelName === 'sale.order' ? ['addons/sale/models/sale_order.py'] : [],
    findUiFiles: async () => ['addons/sale/views/sale_order_views.xml']
  });

  const result = await adapter.augment();
  assert.equal(result.frameworkUiEntrypointSeeds, 1);
  assert.ok(result.uiEntrypointSeeds >= 1);
  assert.ok(topology.symbols.some((symbol) => symbol.name === 'odoo19:sale.order.action_confirm'));
  assert.ok(topology.symbols.some((symbol) => symbol.name === 'odoo19:sale.order._action_confirm'));
});

test('classifies cross-model framework calls', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-cross-model-'));
  const frameworkRoot = path.join(root, 'odoo-source');
  const saleFile = path.join(frameworkRoot, 'addons/sale/models/sale_order.py');
  const stockFile = path.join(frameworkRoot, 'addons/stock/models/stock_rule.py');
  await fs.mkdir(path.dirname(saleFile), { recursive: true });
  await fs.mkdir(path.dirname(stockFile), { recursive: true });
  await fs.writeFile(saleFile, `
from odoo import models
class SaleOrder(models.Model):
    _name = 'sale.order'
    def action_confirm(self):
        self.env['stock.rule'].run([])
`);
  await fs.writeFile(stockFile, `
from odoo import models
class StockRule(models.Model):
    _name = 'stock.rule'
    def run(self, procurements):
        return True
`);
  const topology = topologyStub(root);
  topology.trackedFiles = [];
  topology.odooFramework.modules = ['sale', 'stock'];
  const files = { 'sale.order': ['addons/sale/models/sale_order.py'], 'stock.rule': ['addons/stock/models/stock_rule.py'] };
  const adapter = new OdooExecutionAdapter(topology, {
    source: { repoDir: frameworkRoot, repoUrl: 'x', commit: 'abc' },
    uiEntrypoints: [{ modelName: 'sale.order', methodName: 'action_confirm' }],
    findModelFiles: async ({ modelName }) => files[modelName] || [],
    findUiFiles: async () => []
  });
  const result = await adapter.augment();
  const confirm = topology.symbols.find((symbol) => symbol.name === 'odoo19:sale.order.action_confirm');
  const ref = confirm.references.find((item) => item.name === 'odoo19:stock.rule.run');
  assert.equal(ref.data.boundaryKind, 'cross_model');
  assert.equal(ref.data.sourceModel, 'sale.order');
  assert.equal(ref.data.targetModel, 'stock.rule');
  assert.ok(result.structuralStats.crossModelCalls >= 1);
});

test('accepts facade-provided entrypoints at augment time', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-facade-seed-'));
  const frameworkRoot = path.join(root, 'odoo-source');
  const frameworkFile = path.join(frameworkRoot, 'addons/sale/models/sale_order.py');
  await fs.mkdir(path.dirname(frameworkFile), { recursive: true });
  await fs.writeFile(frameworkFile, `
from odoo import models
class SaleOrder(models.Model):
    _name = 'sale.order'
    def action_confirm(self):
        return True
`);
  const topology = topologyStub(root);
  topology.trackedFiles = [];
  topology.odooFramework.modules = ['sale'];
  const adapter = new OdooExecutionAdapter(topology, {
    source: { repoDir: frameworkRoot, repoUrl: 'https://github.com/odoo/odoo.git', commit: 'abc123' },
    findModelFiles: async ({ modelName }) => modelName === 'sale.order' ? ['addons/sale/models/sale_order.py'] : [],
    findUiFiles: async () => []
  });
  const result = await adapter.augment({ entrypoints: [{ kind: 'object_button', modelName: 'sale.order', methodName: 'action_confirm' }] });
  assert.equal(result.uiEntrypointSeeds, 1);
  assert.ok(topology.symbols.some((symbol) => symbol.name === 'odoo19:sale.order.action_confirm'));
});

test('keeps lifecycle hook model calls out of runtime framework seeding', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-hook-seed-'));
  const manifestFile = path.join(root, 'addons/acme_demo/__manifest__.py');
  const hookFile = path.join(root, 'addons/acme_demo/hooks.py');
  const frameworkRoot = path.join(root, 'odoo-source');
  const frameworkFile = path.join(frameworkRoot, 'addons/sale/models/sale_order.py');
  await fs.mkdir(path.dirname(manifestFile), { recursive: true });
  await fs.mkdir(path.dirname(frameworkFile), { recursive: true });
  await fs.writeFile(manifestFile, `{'post_init_hook': 'post_init_hook'}`);
  await fs.writeFile(hookFile, `
def post_init_hook(env):
    so1 = env['sale.order'].create({'name': 'SO1'})
    so1.action_confirm()
`);
  await fs.writeFile(frameworkFile, `
from odoo import models
class SaleOrder(models.Model):
    _name = 'sale.order'
    def action_confirm(self):
        self._action_confirm()
    def _action_confirm(self):
        return True
`);
  const topology = topologyStub(root);
  topology.trackedFiles = ['addons/acme_demo/__manifest__.py', 'addons/acme_demo/hooks.py'];
  topology.odooDetection = { version: '19', addons: [{ name: 'acme_demo', depends: ['sale'] }] };
  topology.odooFramework.modules = ['sale'];
  const adapter = new OdooExecutionAdapter(topology, {
    source: { repoDir: frameworkRoot, repoUrl: 'https://github.com/odoo/odoo.git', commit: 'abc123' },
    findModelFiles: async ({ modelName }) => modelName === 'sale.order' ? ['addons/sale/models/sale_order.py'] : [],
    findUiFiles: async () => []
  });
  const result = await adapter.augment();
  assert.equal(result.projectHooks, 1);
  const hook = topology.symbols.find((symbol) => symbol.name === 'odoo-project:hook:acme_demo.post_init_hook');
  assert.equal(hook.odooExecution.firstClassMethod, false);
  assert.ok(hook.references.some((ref) => ref.relation === 'writes' && ref.name === 'sale.order' && ref.data.crud === 'create'));
  assert.equal(hook.references.some((ref) => ref.relation === 'calls'), false);
  assert.equal(topology.symbols.some((symbol) => symbol.name === 'odoo19:sale.order.action_confirm'), false);
});

test('reports traversal truncation instead of silently stopping', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-truncate-'));
  const frameworkRoot = path.join(root, 'odoo-source');
  const frameworkFile = path.join(frameworkRoot, 'addons/example/models/example.py');
  await fs.mkdir(path.dirname(frameworkFile), { recursive: true });
  await fs.writeFile(frameworkFile, `
from odoo import models
class Example(models.Model):
    _name = 'example.model'
    def first(self):
        self.second()
    def second(self):
        self.third()
    def third(self):
        return True
`);
  const topology = topologyStub(root);
  topology.trackedFiles = [];
  topology.odooFramework.modules = ['example'];
  const adapter = new OdooExecutionAdapter(topology, {
    source: { repoDir: frameworkRoot, repoUrl: 'x', commit: 'abc' },
    uiEntrypoints: [{ modelName: 'example.model', methodName: 'first' }],
    maxFrameworkMethods: 1,
    findModelFiles: async () => ['addons/example/models/example.py'],
    findUiFiles: async () => []
  });
  const result = await adapter.augment();
  assert.equal(result.truncated, true);
  assert.equal(result.maxFrameworkMethods, 1);
  assert.ok(result.remainingFrameworkQueue > 0);
});
