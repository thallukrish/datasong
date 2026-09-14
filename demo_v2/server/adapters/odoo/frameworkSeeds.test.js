import test from 'node:test';
import assert from 'node:assert/strict';
import { frameworkModelSeeds, frameworkModuleSeeds } from './frameworkSeeds.js';

test('derives standard model seeds without treating project models as framework', () => {
  const schemas = [
    {
      name: 'acme.bom.revision', ownership: 'project',
      relationships: [
        { relatedEntityName: 'mrp.bom' },
        { relatedEntityName: 'acme.approved.supply' }
      ]
    },
    {
      name: 'acme.approved.supply', ownership: 'project', relationships: []
    },
    {
      name: 'mrp.production', ownership: 'project-extension',
      extensionOf: 'odoo19:model:mrp.production',
      relationships: [{ relatedEntityName: 'product.product' }]
    }
  ];

  assert.deepEqual(frameworkModelSeeds(schemas), [
    'mrp.bom', 'mrp.production', 'product.product'
  ]);
});

test('derives standard module seeds from project addon dependencies', () => {
  const addons = [
    { name: 'acme_ems_core', depends: ['product', 'stock'] },
    { name: 'acme_ems_manufacturing', depends: ['acme_ems_core', 'mrp'] },
    { name: 'acme_ems_demo', depends: ['acme_ems_core', 'acme_ems_manufacturing'] }
  ];
  assert.deepEqual(frameworkModuleSeeds(addons), ['mrp', 'product', 'stock']);
});
