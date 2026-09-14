import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureOdooSource, findOdooModelFiles, resolveOdooModuleClosure } from './frameworkSource.js';

async function makeSourceTree() {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-source-'));
  for (const dir of [
    'addons/mrp/models',
    'addons/stock/models',
    'addons/sale_mrp/models',
    'odoo/addons/base/models'
  ]) await fs.mkdir(path.join(repoDir, dir), { recursive: true });

  await fs.writeFile(path.join(repoDir, 'addons/mrp/__manifest__.py'), `{
    'name': 'Manufacturing',
    'version': '19.0.1.0.0',
    'depends': ['stock'],
}`);
  await fs.writeFile(path.join(repoDir, 'addons/stock/__manifest__.py'), `{
    'name': 'Inventory',
    'version': '19.0.1.0.0',
    'depends': ['base'],
}`);
  await fs.writeFile(path.join(repoDir, 'odoo/addons/base/__manifest__.py'), `{
    'name': 'Base',
    'version': '19.0.1.0.0',
    'depends': [],
}`);

  await fs.writeFile(path.join(repoDir, 'addons/mrp/models/mrp_production.py'), `
from odoo import fields, models
class MrpProduction(models.Model):
    _name = 'mrp.production'
    bom_id = fields.Many2one('mrp.bom')
`);
  await fs.writeFile(path.join(repoDir, 'addons/mrp/models/mrp_extension.py'), `
from odoo import fields, models
class MrpProductionExtension(models.Model):
    _inherit = 'mrp.production'
    x_note = fields.Char()
`);
  await fs.writeFile(path.join(repoDir, 'addons/sale_mrp/models/mrp_production.py'), `
from odoo import fields, models
class SaleMrpProduction(models.Model):
    _inherit = 'mrp.production'
    sale_ref = fields.Char()
`);
  return repoDir;
}

test('uses an explicit Odoo source directory and reports its commit', async () => {
  const repoDir = await makeSourceTree();
  const fakeGitFactory = () => ({ revparse: async () => 'abc123\n' });
  const source = await ensureOdooSource({ version: '19', cacheRoot: repoDir, sourceDir: repoDir, gitFactory: fakeGitFactory });
  assert.equal(source.repoDir, repoDir);
  assert.equal(source.repoUrl, 'https://github.com/odoo/odoo.git');
  assert.equal(source.commit, 'abc123');
});

test('resolves only the standard Odoo module dependency closure', async () => {
  const repoDir = await makeSourceTree();
  const modules = await resolveOdooModuleClosure({ repoDir, seeds: ['mrp'] });
  assert.deepEqual(modules, ['base', 'mrp', 'stock']);
});

test('finds model files only inside allowed Odoo addons', async () => {
  const repoDir = await makeSourceTree();
  const fakeGitFactory = () => ({
    raw: async () => 'addons/mrp/models/mrp_production.py\naddons/mrp/models/mrp_extension.py\naddons/sale_mrp/models/mrp_production.py\n'
  });
  const files = await findOdooModelFiles({
    repoDir,
    modelName: 'mrp.production',
    allowedAddons: ['mrp'],
    gitFactory: fakeGitFactory
  });
  assert.deepEqual(files, [
    'addons/mrp/models/mrp_extension.py',
    'addons/mrp/models/mrp_production.py'
  ]);
});
