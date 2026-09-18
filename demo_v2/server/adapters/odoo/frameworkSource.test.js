import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureOdooSource, findOdooModelFiles, findOdooMethodFiles, resolveOdooModuleClosure } from './frameworkSource.js';

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

test('clones Odoo source with long path support enabled', async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-cache-'));
  const calls = [];
  const fakeGitFactory = (repoDir) => repoDir
    ? { revparse: async () => 'abc123\n' }
    : {
        clone: async (repoUrl, targetDir, options) => {
          calls.push({ repoUrl, targetDir, options });
          await fs.mkdir(path.join(targetDir, '.git'), { recursive: true });
        }
      };

  await ensureOdooSource({ version: '19', cacheRoot, gitFactory: fakeGitFactory });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.slice(0, 2), ['--config', 'core.longpaths=true']);
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

test('indexes inherited methods once for the allowed addon closure', async () => {
  const repoDir = await makeSourceTree();
  await fs.writeFile(path.join(repoDir, 'addons/mrp/models/mrp_method.py'), `
from odoo import models
class MrpProduction(models.Model):
    _inherit = 'mrp.production'
    def action_confirm(self):
        return True
    def button_mark_done(self):
        return True
`);

  const calls = [];
  const fakeGitFactory = () => ({
    raw: async (args) => {
      calls.push(args);
      return [
        'addons/mrp/models/mrp_method.py',
        'addons/mrp/models/mrp_production.py',
        'addons/stock/models/unused.py'
      ].join('\n');
    }
  });

  const actionFiles = await findOdooMethodFiles({
    repoDir,
    modelName: 'mrp.production',
    methodName: 'action_confirm',
    allowedAddons: ['mrp', 'stock'],
    gitFactory: fakeGitFactory
  });
  const doneFiles = await findOdooMethodFiles({
    repoDir,
    modelName: 'mrp.production',
    methodName: 'button_mark_done',
    allowedAddons: ['mrp', 'stock'],
    gitFactory: fakeGitFactory
  });

  assert.deepEqual(actionFiles, ['addons/mrp/models/mrp_method.py']);
  assert.deepEqual(doneFiles, ['addons/mrp/models/mrp_method.py']);
  assert.equal(calls.length, 1, 'the addon closure should be scanned only once');
  assert.equal(calls[0][0], 'ls-files');
  assert.ok(calls[0].some((arg) => String(arg).includes('addons/mrp/**/*.py')));
  assert.ok(calls[0].some((arg) => String(arg).includes('addons/stock/**/*.py')));
});
