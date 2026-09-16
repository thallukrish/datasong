import test from 'node:test';
import assert from 'node:assert/strict';
import { withWholeFlowPass2 } from './wholeFlowPass2.js';
import { entityNamesIn } from './structuredWorkflow.js';

const Base = class {
  groupedPathForArc() {
    return { id: 'callpath:7' };
  }

  compactCallPath() {
    return {
      pathId: 'callpath:7',
      functionCount: 4,
      variants: 2,
      alternateEntranceCount: 0,
      terminal: { type: 'end' },
      flowSequence: ['code:sale.order.action_confirm', 'code:stock.rule.run', 'code:mrp.production.create'],
      structuralEvidence: {
        entities: ['sale.order', 'stock.rule', 'mrp.production'],
        entityBoundaries: [{
          from: 'sale.order.action_confirm',
          to: 'stock.rule.run',
          kind: 'cross_model',
          sourceEntity: 'sale.order',
          targetEntity: 'stock.rule'
        }],
        persistence: [{
          at: 'stock.rule._run_manufacture',
          relation: 'writes',
          persistenceKind: 'odoo_orm',
          crud: 'create',
          logicalEntity: 'mrp.production'
        }, {
          at: 'stock.quant._gather',
          relation: 'reads',
          persistenceKind: 'sql',
          crud: 'read',
          persistedEntity: 'stock_quant'
        }]
      }
    };
  }
};

test('whole-flow Pass 2 package preserves structural evidence from Pass 1 path', () => {
  const Explorer = withWholeFlowPass2(Base);
  const explorer = new Explorer();
  const pkg = explorer.compactFlowPackage({ id: 'arc:1' });

  assert.equal(pkg.pathId, 'callpath:7');
  assert.deepEqual(pkg.structuralEvidence.entities, ['sale.order', 'stock.rule', 'mrp.production']);
  assert.equal(pkg.structuralEvidence.entityBoundaries[0].kind, 'cross_model');
  assert.equal(pkg.structuralEvidence.persistence[0].crud, 'create');
  assert.equal(pkg.structuralEvidence.persistence[1].persistedEntity, 'stock_quant');
});

test('structured workflow schema lookup sees entities from canonical structural evidence', () => {
  const names = entityNamesIn({
    structuralEvidence: {
      entities: ['sale.order'],
      entityBoundaries: [{ sourceEntity: 'sale.order', targetEntity: 'stock.rule' }],
      persistence: [{ logicalEntity: 'mrp.production', crud: 'create' }, { persistedEntity: 'mrp_production', crud: 'create' }]
    },
    signatures: ['<entity-find entity-name="mantle.order.OrderHeader"/>']
  });

  assert.deepEqual(names, ['sale.order', 'stock.rule', 'mrp.production', 'mantle.order.OrderHeader']);
  assert.equal(names.includes('mrp_production'), false, 'physical table names must not be treated as logical entity schemas');
});
