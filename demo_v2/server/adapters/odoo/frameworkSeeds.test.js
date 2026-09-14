import test from 'node:test';
import assert from 'node:assert/strict';
import { frameworkModelSeeds } from './frameworkSeeds.js';

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
