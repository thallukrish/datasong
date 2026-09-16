import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OdooExecutionAdapter } from './executionAdapter.js';

function topologyStub(root) {
  const symbols = [];
  return {
    repoDir: root,
    cacheRoot: path.join(root, 'cache'),
    trackedFiles: [],
    odooDetection: { version: '19', addons: [] },
    odooFramework: { modules: ['example_parent', 'example_line'] },
    entitySchemaByName: new Map([
      ['example.parent', {
        name: 'example.parent',
        fields: [{ name: 'line_ids', relatedModel: 'example.line' }],
        relationships: [{ title: 'line_ids', relatedEntityName: 'example.line' }]
      }]
    ]),
    symbols,
    symbolById: new Map(),
    nameIndex: new Map(),
    addSemanticFunction(input) {
      const id = `${input.sourcePath}:${input.name}:${input.line}`;
      const symbol = { id, simpleName: input.name.split(/[.:/]/).at(-1), references: [], ...input };
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

test('resolves self relational-field calls through Odoo schema into the related model', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-field-call-'));
  const frameworkRoot = path.join(root, 'odoo-source');
  const parentFile = path.join(frameworkRoot, 'addons/example_parent/models/parent.py');
  const lineFile = path.join(frameworkRoot, 'addons/example_line/models/line.py');
  await fs.mkdir(path.dirname(parentFile), { recursive: true });
  await fs.mkdir(path.dirname(lineFile), { recursive: true });
  await fs.writeFile(parentFile, `
from odoo import models
class ExampleParent(models.Model):
    _name = 'example.parent'
    def action_start(self):
        self.line_ids._launch_rule()
        return super(ExampleParent, self).action_start()
`);
  await fs.writeFile(lineFile, `
from odoo import models
class ExampleLine(models.Model):
    _name = 'example.line'
    def _launch_rule(self):
        return True
`);

  const topology = topologyStub(root);
  const adapter = new OdooExecutionAdapter(topology, {
    source: { repoDir: frameworkRoot, repoUrl: 'odoo/odoo', commit: 'fixture' },
    uiEntrypoints: [{ modelName: 'example.parent', methodName: 'action_start' }],
    findModelFiles: async ({ modelName }) => {
      if (modelName === 'example.parent') return ['addons/example_parent/models/parent.py'];
      if (modelName === 'example.line') return ['addons/example_line/models/line.py'];
      return [];
    }
  });

  const result = await adapter.augment();
  const parent = topology.symbols.find((symbol) => symbol.name === 'odoo19:example.parent.action_start');
  const line = topology.symbols.find((symbol) => symbol.name === 'odoo19:example.line._launch_rule');
  assert.ok(parent);
  assert.ok(line);
  assert.ok(parent.references.some((ref) => ref.relation === 'calls' && ref.name === line.name));
  assert.equal(result.unresolvedCalls.includes('example.parent.line_ids._launch_rule'), false);
});
