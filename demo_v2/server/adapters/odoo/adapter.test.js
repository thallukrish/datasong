import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OdooAdapter } from './adapter.js';

test('facade combines static UI entrypoints, execution report and runtime-evidence assessment', async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-adapter-'));
  const xmlPath = 'addons/acme/views/sale.xml';
  await fs.mkdir(path.dirname(path.join(repoDir, xmlPath)), { recursive: true });
  await fs.writeFile(path.join(repoDir, xmlPath), `<odoo>
    <record id="sale_form" model="ir.ui.view">
      <field name="model">sale.order</field>
      <field name="arch" type="xml">
        <form><button name="action_confirm" type="object"/></form>
      </field>
    </record>
  </odoo>`);

  const topology = {
    repoDir,
    trackedFiles: [xmlPath],
    odooDetection: { version: '19', addons: [{ name: 'acme' }] }
  };

  const adapter = new OdooAdapter(topology, {
    schemaAdapter: { augment: async () => ({ schemas: [] }) },
    frameworkEnricher: { augment: async () => ({ frameworkSchemas: [], modules: ['sale'] }) },
    executionAdapter: {
      augment: async ({ entrypoints } = {}) => ({
        projectMethods: 0,
        frameworkMethods: entrypoints.length,
        unresolvedCalls: ['stock.rule.run'],
        source: { repoUrl: 'odoo/odoo', commit: 'fixture' }
      })
    }
  });

  const result = await adapter.augment();
  assert.deepEqual(result.ui.entrypoints.map((item) => `${item.modelName}.${item.methodName}`), [
    'sale.order.action_confirm'
  ]);
  assert.equal(result.evidence.runtimeEvidenceRequired, true);
  assert.deepEqual(result.evidence.ambiguousBoundaries, ['stock.rule.run']);
  assert.equal(result.execution.frameworkMethods, 1);
});
