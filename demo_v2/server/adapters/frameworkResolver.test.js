import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFrameworkAdapters } from './frameworkResolver.js';

test('selects Odoo adapter from manifest evidence', async () => {
  const resolved = await resolveFrameworkAdapters(
    { repoDir: '/tmp/repo', trackedFiles: ['addons/acme/__manifest__.py'] },
    {
      detectOdoo: async () => ({ detected: true, version: '19', addons: [] }),
      createOdoo: () => ({ entitySchema: 'odoo', execution: null })
    }
  );
  assert.equal(resolved.kind, 'odoo');
});

test('selects Moqui adapter from component.xml evidence', async () => {
  const resolved = await resolveFrameworkAdapters(
    { repoDir: '/tmp/repo', trackedFiles: ['component.xml'] },
    {
      detectOdoo: async () => ({ detected: false, version: '', addons: [] }),
      createMoqui: () => ({ entitySchema: 'moqui', execution: 'moqui' })
    }
  );
  assert.equal(resolved.kind, 'moqui');
});

test('selects generic when framework evidence is absent', async () => {
  const resolved = await resolveFrameworkAdapters(
    { repoDir: '/tmp/repo', trackedFiles: ['src/index.js'] },
    { detectOdoo: async () => ({ detected: false, version: '', addons: [] }) }
  );
  assert.equal(resolved.kind, 'generic');
  assert.equal(resolved.adapters.entitySchema, null);
});
