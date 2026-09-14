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
    odooFramework: { modules: ['base', 'mrp', 'stock'] },
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

test('bridges a project super call into targeted Odoo framework methods', async () => {
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
    findModelFiles: async ({ modelName }) => modelName === 'mrp.production' ? ['addons/mrp/models/mrp_production.py'] : []
  });
  const result = await adapter.augment();

  assert.equal(result.bridgedSuperCalls, 1);
  const project = topology.symbols.find((symbol) => symbol.name === 'odoo-project:mrp.production.action_confirm');
  const base = topology.symbols.find((symbol) => symbol.name === 'odoo19:mrp.production.action_confirm');
  const createMoves = topology.symbols.find((symbol) => symbol.name === 'odoo19:mrp.production._create_moves');
  assert.ok(project.references.some((ref) => ref.relation === 'calls' && ref.name === base.name));
  assert.ok(base.references.some((ref) => ref.relation === 'calls' && ref.name === createMoves.name));
  assert.ok(createMoves.references.some((ref) => ref.relation === 'writes' && ref.name === 'stock.move'));
});
