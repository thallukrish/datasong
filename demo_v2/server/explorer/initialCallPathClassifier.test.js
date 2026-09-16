import test from 'node:test';
import assert from 'node:assert/strict';
import { withInitialCallPathClassifier } from './initialCallPathClassifier.js';

const Base = class {
  normalizeCallPathClassification(raw) {
    return { _callPathPreprocess: true, paths: Array.isArray(raw?.paths) ? raw.paths : [] };
  }
};

function makeExplorer() {
  const Explorer = withInitialCallPathClassifier(Base);
  const explorer = new Explorer();

  const sale = {
    id: 's1',
    name: 'odoo19:sale.order.action_confirm',
    signature: 'sale.order.def action_confirm(self)',
    references: [{
      name: 'odoo19:stock.rule.run',
      relation: 'calls',
      explicit: true,
      data: {
        framework: 'odoo',
        boundaryKind: 'cross_model',
        sourceModel: 'sale.order',
        targetModel: 'stock.rule'
      }
    }]
  };
  const rule = {
    id: 's2',
    name: 'odoo19:stock.rule.run',
    signature: 'stock.rule.def run(self, procurements)',
    references: [{
      name: 'mrp.production',
      relation: 'writes',
      explicit: true,
      data: {
        operationKind: 'persistence',
        persistenceKind: 'odoo_orm',
        crud: 'create',
        logicalEntity: 'mrp.production'
      }
    }, {
      name: 'stock_move',
      relation: 'reads',
      explicit: true,
      data: {
        operationKind: 'persistence',
        persistenceKind: 'sql',
        crud: 'read',
        persistedEntity: 'stock_move'
      }
    }]
  };

  const path = {
    id: 'callpath:1',
    functionCount: 2,
    symbolIds: ['s1', 's2'],
    normalizedFlowTokens: ['code:sale.order.def action_confirm(self)', 'code:stock.rule.def run(self, procurements)'],
    branchVariantCount: 1,
    alternateEntranceCount: 0,
    duplicateVariantCount: 0,
    terminal: { type: 'end' }
  };

  explorer.topology = {
    symbolById: new Map([['s1', sale], ['s2', rule]]),
    topCallPaths: () => [path]
  };
  return { explorer, path };
}

test('Pass 1 compact call paths include entity-boundary and persistence landmarks', () => {
  const { explorer, path } = makeExplorer();
  const compact = explorer.compactCallPath(path);

  assert.deepEqual(compact.structuralEvidence.entities, ['mrp.production', 'sale.order', 'stock.rule']);
  assert.deepEqual(compact.structuralEvidence.entityBoundaries, [{
    from: 'sale.order.def action_confirm(self)',
    to: 'stock.rule.def run(self, procurements)',
    kind: 'cross_model',
    sourceEntity: 'sale.order',
    targetEntity: 'stock.rule'
  }]);
  assert.deepEqual(compact.structuralEvidence.persistence, [{
    at: 'stock.rule.def run(self, procurements)',
    relation: 'writes',
    persistenceKind: 'odoo_orm',
    crud: 'create',
    logicalEntity: 'mrp.production'
  }, {
    at: 'stock.rule.def run(self, procurements)',
    relation: 'reads',
    persistenceKind: 'sql',
    crud: 'read',
    persistedEntity: 'stock_move'
  }]);
});

test('Pass 1 prompt carries structural evidence without changing CallPathIndexer tokens', () => {
  const { explorer } = makeExplorer();
  const prompt = explorer.callPathPrompt();

  assert.match(prompt, /^MODE call-path-business-seed-classification-v5/);
  assert.match(prompt, /"kind":"cross_model","sourceEntity":"sale\.order","targetEntity":"stock\.rule"/);
  assert.match(prompt, /"entityBoundaries":\[\{"from":"sale\.order\.def action_confirm\(self\)"/);
  assert.match(prompt, /"persistenceKind":"odoo_orm","crud":"create","logicalEntity":"mrp\.production"/);
  assert.match(prompt, /"flowSequence":\["code:sale\.order\.def action_confirm\(self\)"/);
});
