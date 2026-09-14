import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureOdooSource, findOdooModelFiles } from './frameworkSource.js';

async function makeSourceTree() {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-source-'));
  await fs.mkdir(path.join(repoDir, 'addons/mrp/models'), { recursive: true });
  await fs.mkdir(path.join(repoDir, 'addons/unrelated/models'), { recursive: true });
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
  await fs.writeFile(path.join(repoDir, 'addons/unrelated/models/example.py'), `
from odoo import models
class Example(models.Model):
    _name = 'unrelated.example'
    note = 'mrp.production'
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

test('finds only files that define or extend the requested Odoo model', async () => {
  const repoDir = await makeSourceTree();
  const fakeGitFactory = () => ({
    raw: async () => 'addons/mrp/models/mrp_production.py\naddons/mrp/models/mrp_extension.py\naddons/unrelated/models/example.py\n'
  });
  const files = await findOdooModelFiles({ repoDir, modelName: 'mrp.production', gitFactory: fakeGitFactory });
  assert.deepEqual(files, [
    'addons/mrp/models/mrp_extension.py',
    'addons/mrp/models/mrp_production.py'
  ]);
});
