import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectOdooRepository } from './detect.js';

test('detects Odoo addons and manifest dependencies', async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-'));
  const manifestPath = 'addons/acme_ems_manufacturing/__manifest__.py';
  await fs.mkdir(path.join(repoDir, 'addons/acme_ems_manufacturing'), { recursive: true });
  await fs.writeFile(path.join(repoDir, manifestPath), `{
    'name': 'ACME EMS Manufacturing',
    'version': '19.0.1.0.0',
    'depends': ['mrp', 'stock'],
    'data': ['views/manufacturing_views.xml'],
    'installable': True,
    'application': False,
  }`);

  const result = await detectOdooRepository({ repoDir, trackedFiles: [manifestPath] });
  assert.equal(result.detected, true);
  assert.equal(result.version, '19');
  assert.deepEqual(result.addons[0].depends, ['mrp', 'stock']);
  assert.deepEqual(result.addons[0].data, ['views/manufacturing_views.xml']);
});
