import test from 'node:test';
import assert from 'node:assert/strict';
import { composeOdooSchemas } from './composeSchemas.js';

test('composes standard Odoo schema with project extension fields and relationships', () => {
  const frameworkSchemas = [{
    name: 'mrp.production',
    fullName: 'mrp.production',
    stableId: 'odoo19:model:mrp.production',
    ownership: 'framework',
    fields: [
      { name: 'name', type: 'Char' },
      { name: 'bom_id', type: 'Many2one', relatedModel: 'mrp.bom', relation: 'many-to-one' }
    ],
    relationships: [
      { type: 'many-to-one', relatedEntityName: 'mrp.bom', title: 'bom_id', keyMaps: [] }
    ],
    provenance: { layer: 'framework', sourcePath: 'addons/mrp/models/mrp_production.py' }
  }];
  const projectSchemas = [
    {
      name: 'mrp.production',
      fullName: 'mrp.production',
      stableId: 'odoo19:model:mrp.production',
      ownership: 'project-extension',
      fields: [
        { name: 'ems_shortage_qty', type: 'Float' },
        { name: 'ems_blocking_component_id', type: 'Many2one', relatedModel: 'product.product', relation: 'many-to-one' }
      ],
      relationships: [
        { type: 'many-to-one', relatedEntityName: 'product.product', title: 'ems_blocking_component_id', keyMaps: [] }
      ],
      provenance: { layer: 'project', sourcePath: 'addons/acme_ems_manufacturing/models/mrp_production.py' }
    },
    {
      name: 'acme.manufacturer.part',
      fullName: 'acme.manufacturer.part',
      stableId: 'odoo19:model:acme.manufacturer.part',
      ownership: 'project',
      fields: [{ name: 'mpn', type: 'Char' }],
      relationships: [],
      provenance: { layer: 'project', sourcePath: 'addons/acme_ems_core/models/manufacturer_part.py' }
    }
  ];

  const result = composeOdooSchemas({ frameworkSchemas, projectSchemas });
  const production = result.find((schema) => schema.name === 'mrp.production');
  assert.equal(result.length, 2);
  assert.equal(production.ownership, 'composed');
  assert.deepEqual(production.layers, ['framework', 'project-extension']);
  assert.deepEqual(production.fields.map((field) => field.name).sort(), [
    'bom_id', 'ems_blocking_component_id', 'ems_shortage_qty', 'name'
  ]);
  assert.equal(production.relationships.length, 2);
  assert.equal(result.find((schema) => schema.name === 'acme.manufacturer.part').ownership, 'project');
});
