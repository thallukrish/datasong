import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressiveRepositoryTopologyV9 } from '../../progressiveRepositoryTopologyV9.js';

test('composes framework schemas into the Odoo effective schema catalog without replacing Moqui adapters', async () => {
  const topology = new ProgressiveRepositoryTopologyV9({ cacheRoot: './data/test-cache' });
  const moquiAdapter = topology.moquiEntitySchemaAdapter;
  const projectSchemas = [{
    name: 'mrp.production', fullName: 'mrp.production', ownership: 'project-extension',
    stableId: 'odoo19:model:mrp.production', fields: [{ name: 'ems_shortage_qty', type: 'Float' }],
    relationships: [], provenance: { layer: 'project' }
  }];
  topology.entitySchemas = projectSchemas;
  topology.odooAdapters = {
    frameworkEnricher: {
      augment: async (received) => {
        assert.equal(received, projectSchemas);
        return {
          seeds: ['mrp.production'], learned: ['mrp.production'], reused: [], missing: [],
          source: { repoUrl: 'https://github.com/odoo/odoo.git', commit: 'abc' },
          frameworkSchemas: [{
            name: 'mrp.production', fullName: 'mrp.production', ownership: 'framework',
            stableId: 'odoo19:model:mrp.production', fields: [{ name: 'name', type: 'Char' }],
            relationships: [], provenance: { layer: 'framework' }
          }]
        };
      }
    }
  };

  const result = await topology.enrichOdooFrameworkSchemas(projectSchemas);
  assert.equal(result.learned[0], 'mrp.production');
  assert.equal(topology.entitySchemas.length, 1);
  assert.equal(topology.entitySchema('mrp.production').ownership, 'composed');
  assert.deepEqual(topology.entitySchema('mrp.production').fields.map((field) => field.name).sort(), ['ems_shortage_qty', 'name']);
  assert.equal(topology.moquiEntitySchemaAdapter, moquiAdapter);
});
