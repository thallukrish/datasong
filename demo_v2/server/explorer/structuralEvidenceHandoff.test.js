import test from 'node:test';
import assert from 'node:assert/strict';
import { withWholeFlowPass2 } from './wholeFlowPass2.js';
import { entityNamesIn } from './structuredWorkflow.js';

const Base = class {
  groupedPathForArc() {
    return {
      id: 'callpath:7',
      symbolIds: ['s-sale', 's-rule', 's-moqui'],
      alternatives: [{ symbolIds: ['s-mrp', 's-rule'] }]
    };
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

function explorerWithSymbols() {
  const Explorer = withWholeFlowPass2(Base);
  const explorer = new Explorer();
  explorer.topology = {
    symbolById: new Map([
      ['s-sale', {
        id: 's-sale',
        name: 'odoo19:sale.order.action_confirm',
        signature: 'sale.order.def action_confirm(self)',
        sourcePath: '@odoo19/addons/sale/models/sale_order.py',
        body: 'self._action_confirm()'
      }],
      ['s-rule', {
        id: 's-rule',
        name: 'odoo19:stock.rule.run',
        signature: 'stock.rule.def run(self, procurements)',
        sourcePath: '@odoo19/addons/stock/models/stock_rule.py',
        body: 'getattr(self, method_name)(procurements)'
      }],
      ['s-mrp', {
        id: 's-mrp',
        name: 'odoo19:stock.rule._run_manufacture',
        signature: 'stock.rule.def _run_manufacture(self, procurements)',
        sourcePath: '@odoo19/addons/mrp/models/stock_rule.py',
        body: "self.env['mrp.production'].create(vals)"
      }],
      ['s-moqui', {
        id: 's-moqui',
        name: 'moqui:transition:approve',
        signature: '<transition name="approve">',
        sourcePath: 'component/screen.xml'
      }]
    ])
  };
  return explorer;
}

test('whole-flow Pass 2 package preserves structural evidence from Pass 1 path', () => {
  const explorer = explorerWithSymbols();
  const pkg = explorer.compactFlowPackage({ id: 'arc:1' });

  assert.equal(pkg.pathId, 'callpath:7');
  assert.deepEqual(pkg.structuralEvidence.entities, ['sale.order', 'stock.rule', 'mrp.production']);
  assert.equal(pkg.structuralEvidence.entityBoundaries[0].kind, 'cross_model');
  assert.equal(pkg.structuralEvidence.persistence[0].crud, 'create');
  assert.equal(pkg.structuralEvidence.persistence[1].persistedEntity, 'stock_quant');
});

test('Pass 2 dereferences source bodies from representative and alternative path symbols', () => {
  const explorer = explorerWithSymbols();
  const pkg = explorer.compactFlowPackage({ id: 'arc:1' });

  assert.deepEqual(pkg.functionEvidence.map((item) => item.symbolId), ['s-sale', 's-rule', 's-mrp']);
  assert.equal(pkg.functionEvidence[0].body, 'self._action_confirm()');
  assert.equal(pkg.functionEvidence[2].body, "self.env['mrp.production'].create(vals)");
  assert.equal(pkg.functionEvidence.some((item) => item.symbolId === 's-moqui'), false, 'symbols without source bodies must not add empty function evidence');
});

test('Pass 2 omits functionEvidence completely when selected symbols have no bodies', () => {
  const Explorer = withWholeFlowPass2(class extends Base {
    groupedPathForArc() {
      return { id: 'callpath:moqui', symbolIds: ['m1'], alternatives: [] };
    }
  });
  const explorer = new Explorer();
  explorer.topology = {
    symbolById: new Map([['m1', {
      id: 'm1', name: 'moqui:service-call', signature: '<service-call name="x"/>', sourcePath: 'screen.xml'
    }]])
  };

  const pkg = explorer.compactFlowPackage({ id: 'arc:moqui' });
  assert.equal(Object.hasOwn(pkg, 'functionEvidence'), false);
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
