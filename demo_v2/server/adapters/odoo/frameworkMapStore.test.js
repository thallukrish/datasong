import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OdooFrameworkMapStore } from './frameworkMapStore.js';

test('initializes, persists and deduplicates framework schemas and sources', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-map-'));
  const store = new OdooFrameworkMapStore({ dataRoot, version: '19' });
  const empty = store.load();
  assert.equal(empty.framework, 'odoo');
  assert.deepEqual(empty.schemas, {});

  const source = { repoUrl: 'https://github.com/odoo/odoo.git', commit: 'abc123' };
  store.mergeSchemas({ source, schemas: [{ stableId: 'odoo19:model:mrp.production', name: 'mrp.production', fields: [] }] });
  store.mergeSchemas({ source, schemas: [{ stableId: 'odoo19:model:mrp.production', name: 'mrp.production', fields: [{ name: 'bom_id' }] }] });

  const saved = store.load();
  assert.equal(saved.sources.length, 1);
  assert.equal(Object.keys(saved.schemas).length, 1);
  assert.equal(saved.schemas['odoo19:model:mrp.production'].fields[0].name, 'bom_id');
  await fs.access(path.join(dataRoot, 'semantic-maps', 'frameworks', 'odoo', '19', 'map.json'));
});
