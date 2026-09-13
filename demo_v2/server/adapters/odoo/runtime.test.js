import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOdooRuntime } from './runtime.js';

test('returns Odoo runtime when manifest evidence is detected', async () => {
  const topology = { repoDir: '/tmp/repo', trackedFiles: ['addons/acme/__manifest__.py'] };
  const resolved = await resolveOdooRuntime(topology, {
    detectOdoo: async () => ({ detected: true, version: '19', addons: [] }),
    createOdoo: () => ({ entitySchema: 'odoo-schema', execution: null })
  });
  assert.equal(resolved.detection.version, '19');
  assert.equal(resolved.adapters.entitySchema, 'odoo-schema');
});

test('returns null for non-Odoo repositories', async () => {
  const resolved = await resolveOdooRuntime(
    { repoDir: '/tmp/repo', trackedFiles: ['component.xml'] },
    { detectOdoo: async () => ({ detected: false, version: '', addons: [] }) }
  );
  assert.equal(resolved, null);
});
