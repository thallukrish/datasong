import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OdooFrameworkMapStore } from './frameworkMapStore.js';
import { OdooFrameworkEnricher } from './frameworkEnricher.js';

async function writeModel(repoDir, relativePath, source) {
  const absolute = path.join(repoDir, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, source);
}

test('learns one targeted relationship hop and reuses persisted schemas', async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-framework-'));
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-framework-map-'));

  await writeModel(repoDir, 'addons/mrp/models/mrp_production.py', `
from odoo import fields, models
class MrpProduction(models.Model):
    _name = 'mrp.production'
    bom_id = fields.Many2one('mrp.bom')
    product_id = fields.Many2one('product.product')
`);
  await writeModel(repoDir, 'addons/mrp/models/mrp_bom.py', `
from odoo import fields, models
class MrpBom(models.Model):
    _name = 'mrp.bom'
    product_tmpl_id = fields.Many2one('product.template')
`);
  await writeModel(repoDir, 'addons/product/models/product.py', `
from odoo import fields, models
class ProductProduct(models.Model):
    _name = 'product.product'
    name = fields.Char()
`);

  const source = { repoDir, repoUrl: 'https://github.com/odoo/odoo.git', commit: 'odoo-test' };
  const filesByModel = {
    'mrp.production': ['addons/mrp/models/mrp_production.py'],
    'mrp.bom': ['addons/mrp/models/mrp_bom.py'],
    'product.product': ['addons/product/models/product.py']
  };
  const calls = [];
  const findModelFiles = async ({ modelName }) => {
    calls.push(modelName);
    return filesByModel[modelName] || [];
  };
  const topology = {
    cacheRoot: path.join(dataRoot, 'repo-cache'),
    odooDetection: { version: '19' }
  };
  const store = new OdooFrameworkMapStore({ dataRoot, version: '19' });
  const projectSchemas = [{
    name: 'mrp.production', ownership: 'project-extension',
    extensionOf: 'odoo19:model:mrp.production', relationships: []
  }];

  const first = await new OdooFrameworkEnricher(topology, {
    source, store, findModelFiles, maxDepth: 1
  }).augment(projectSchemas);

  assert.deepEqual(first.seeds, ['mrp.production']);
  assert.deepEqual(first.learned.sort(), ['mrp.bom', 'mrp.production', 'product.product']);
  assert.equal(first.frameworkSchemas.find((schema) => schema.name === 'mrp.production').ownership, 'framework');
  assert.equal(first.frameworkSchemas.find((schema) => schema.name === 'mrp.bom').provenance.layer, 'framework');
  assert.equal(calls.includes('product.template'), false);

  calls.length = 0;
  const second = await new OdooFrameworkEnricher(topology, {
    source, store, findModelFiles, maxDepth: 1
  }).augment(projectSchemas);

  assert.deepEqual(second.reused.sort(), ['mrp.bom', 'mrp.production', 'product.product']);
  assert.deepEqual(calls, []);
});
