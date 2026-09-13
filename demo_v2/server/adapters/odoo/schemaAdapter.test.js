import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OdooEntitySchemaAdapter } from './schemaAdapter.js';

test('materializes project Odoo schema with stable framework reference', async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-schema-'));
  const sourcePath = 'addons/acme_ems_manufacturing/models/mrp_production.py';
  await fs.mkdir(path.dirname(path.join(repoDir, sourcePath)), { recursive: true });
  await fs.writeFile(path.join(repoDir, sourcePath), `
class MrpProduction(models.Model):
    _inherit = 'mrp.production'
    ems_shortage_qty = fields.Float()
`);
  const topology = {
    repoDir,
    trackedFiles: [sourcePath],
    odooDetection: { version: '19', addons: [{ name: 'acme_ems_manufacturing' }] },
    entitySchemas: [],
    entitySchemaByName: new Map()
  };
  const result = await new OdooEntitySchemaAdapter(topology).augment();
  const schema = topology.entitySchemaByName.get('mrp.production');
  assert.equal(result.adapter, 'odoo-entity-schema-v1');
  assert.equal(schema.stableId, 'odoo19:model:mrp.production');
  assert.equal(schema.ownership, 'project-extension');
  assert.equal(schema.extensionOf, 'odoo19:model:mrp.production');
});
