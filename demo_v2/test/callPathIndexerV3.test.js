import test from 'node:test';
import assert from 'node:assert/strict';
import { CallPathIndexerV3 } from '../server/callPathIndexerV3.js';

function topologyFor(edges) {
  const ids = [...new Set([...Object.keys(edges), ...Object.values(edges).flat()])];
  const symbols = ids.map((id) => ({ id, name: id, simpleName: id, signature: `${id}()`, sourcePath: 'synthetic.js', references: [] }));
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  return {
    symbols,
    symbolById: byId,
    outboundReferenceCandidates(symbol) {
      return (edges[symbol.id] || []).map((target) => ({ target: byId.get(target), relation: 'calls' }));
    },
    resolveOutboundReference() { return []; }
  };
}

function priorityProfile() {
  return {
    version: 'test-profile-v2',
    firstClassNodes: {
      metadataPath: 'odooExecution',
      flags: ['firstClassEntity', 'firstClassMethod'],
      identityField: 'modelName'
    },
    excludeWhen: [{ path: 'odooExecution.hookType', values: ['post_init_hook'] }],
    excludedPriorityScore: -1000000,
    weights: {
      firstClassNode: 100,
      crossEntityBoundary: 20,
      persistenceWrite: 5,
      persistenceRead: 2,
      sqlPersistence: 3,
      executableRelation: 2,
      function: 0.25,
      isolatedNoEntityNoPersistence: -12
    }
  };
}

function structuralPriorityTopology({ enabled = true } = {}) {
  const symbols = [
    { id: 'DeployA', name: 'DeployA', signature: 'DeployA()', sourcePath: 'docker-compose.yml', references: [{ relation: 'calls', name: 'DeployB' }] },
    { id: 'DeployB', name: 'DeployB', signature: 'DeployB()', sourcePath: 'docker-compose.yml', references: [{ relation: 'calls', name: 'DeployC' }] },
    { id: 'DeployC', name: 'DeployC', signature: 'DeployC()', sourcePath: 'docker-compose.yml', references: [{ relation: 'calls', name: 'DeployD' }] },
    { id: 'DeployD', name: 'DeployD', signature: 'DeployD()', sourcePath: 'docker-compose.yml', references: [] },
    {
      id: 'SaleConfirm', name: 'SaleConfirm', signature: 'sale.order.action_confirm()', sourcePath: 'sale.py',
      odooExecution: { firstClassEntity: true, firstClassMethod: true, modelName: 'sale.order' },
      references: [{ relation: 'calls', name: 'SaleHelper', data: { sourceModel: 'sale.order', targetModel: 'sale.order', boundaryKind: 'same_model' } }]
    },
    {
      id: 'SaleHelper', name: 'SaleHelper', signature: 'sale.order._action_confirm()', sourcePath: 'sale.py',
      odooExecution: { firstClassEntity: true, firstClassMethod: true, modelName: 'sale.order' },
      references: [{ relation: 'calls', name: 'StockRun', data: { sourceModel: 'sale.order', targetModel: 'stock.rule', boundaryKind: 'cross_model' } }]
    },
    {
      id: 'StockRun', name: 'StockRun', signature: 'stock.rule.run()', sourcePath: 'stock.py',
      odooExecution: { firstClassEntity: true, firstClassMethod: true, modelName: 'stock.rule' },
      references: [{ relation: 'calls', name: 'ProductionCreate', data: { sourceModel: 'stock.rule', targetModel: 'mrp.production', boundaryKind: 'cross_model' } }]
    },
    {
      id: 'ProductionCreate', name: 'ProductionCreate', signature: 'mrp.production.create()', sourcePath: 'mrp.py',
      odooExecution: { firstClassEntity: true, firstClassMethod: true, modelName: 'mrp.production' },
      references: [{ relation: 'writes', name: 'mrp.production', data: { operationKind: 'persistence', persistenceKind: 'odoo_orm', crud: 'create', logicalEntity: 'mrp.production', persistedEntity: 'mrp_production' } }]
    },
    {
      id: 'SetupHook', name: 'SetupHook', signature: 'post_init_hook()', sourcePath: 'hooks.py',
      odooExecution: { firstClassEntity: false, firstClassMethod: false, hookType: 'post_init_hook' },
      references: [
        { relation: 'writes', name: 'sale.order', data: { operationKind: 'persistence', persistenceKind: 'odoo_orm', crud: 'create', logicalEntity: 'sale.order' } },
        { relation: 'writes', name: 'mrp.production', data: { operationKind: 'persistence', persistenceKind: 'odoo_orm', crud: 'create', logicalEntity: 'mrp.production' } },
        { relation: 'writes', name: 'stock.lot', data: { operationKind: 'persistence', persistenceKind: 'odoo_orm', crud: 'create', logicalEntity: 'stock.lot' } }
      ]
    }
  ];
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const edges = {
    DeployA: ['DeployB'], DeployB: ['DeployC'], DeployC: ['DeployD'], DeployD: [],
    SaleConfirm: ['SaleHelper'], SaleHelper: ['StockRun'], StockRun: ['ProductionCreate'], ProductionCreate: [],
    SetupHook: []
  };
  return {
    symbols,
    symbolById: byId,
    outboundReferenceCandidates(symbol) {
      return (edges[symbol.id] || []).map((target) => ({ target: byId.get(target), relation: 'calls' }));
    },
    resolveOutboundReference() { return []; },
    ...(enabled ? { callPathPriorityProfile: () => priorityProfile() } : {})
  };
}

test('dominant common prefix merges diverging tails into one branch family', () => {
  const indexer = new CallPathIndexerV3(topologyFor({
    Login: ['Actions'], Actions: ['Script'], Script: ['Existing'], Existing: ['A', 'B'], A: [], B: []
  }));
  indexer.build();
  const family = indexer.top(10).find((path) => path.signatures[0] === 'Login()');
  assert.ok(family);
  assert.equal(family.branchVariantCount, 2);
  assert.ok(family.mergedStructure);
  assert.deepEqual(family.mergedStructure.commonPrefix.slice(0, 4), ['code:login()', 'code:actions()', 'code:script()', 'code:existing()']);
  assert.equal(family.mergedStructure.branches.length, 2);
});

test('dominant common prefix with reconvergent suffix keeps suffix once', () => {
  const indexer = new CallPathIndexerV3(topologyFor({
    Login: ['Actions'], Actions: ['Script'], Script: ['Existing'], Existing: ['A', 'B'], A: ['Merge'], B: ['Merge'], Merge: []
  }));
  indexer.build();
  const family = indexer.top(10).find((path) => path.signatures[0] === 'Login()');
  assert.ok(family?.mergedStructure);
  assert.deepEqual(family.mergedStructure.commonSuffix, ['code:merge()']);
});

test('small different prefixes converging on a dominant suffix are alternate entrances', () => {
  const indexer = new CallPathIndexerV3(topologyFor({
    A: ['Core'], X: ['Core'], Core: ['Step2'], Step2: ['Step3'], Step3: ['Step4'], Step4: []
  }));
  indexer.build();
  const family = indexer.top(10).find((path) => path.alternateEntranceCount > 0);
  assert.ok(family);
  assert.equal(family.alternateEntranceCount, 1);
});

test('large distinct prefixes converging on a common suffix remain separate and expose shared subflow', () => {
  const indexer = new CallPathIndexerV3(topologyFor({
    A1: ['A2'], A2: ['A3'], A3: ['Core'],
    B1: ['B2'], B2: ['B3'], B3: ['Core'],
    Core: ['S2'], S2: ['S3'], S3: ['S4'], S4: []
  }));
  indexer.build();
  const top = indexer.top(10);
  assert.ok(top.length >= 2);
  const refs = top.flatMap((path) => path.sharedSubflowRefs || []);
  assert.ok(refs.some((ref) => (ref.sharedSuffix || []).length >= 4));
});

test('configured first-class scoring counts distinct traversed model nodes, not repeated methods or persistence targets', () => {
  const indexer = new CallPathIndexerV3(structuralPriorityTopology());
  indexer.build();
  const top = indexer.top(10);
  assert.equal(top[0].entrySymbolId, 'SaleConfirm');
  assert.equal(top[0].structuralPriorityEvidence.firstClassNodeCount, 3);
  assert.deepEqual(top[0].structuralPriorityEvidence.firstClassNodes, ['mrp.production', 'sale.order', 'stock.rule']);
  assert.equal(top[0].structuralPriorityEvidence.crossEntityBoundaryCount, 2);
  assert.equal(top[0].structuralPriorityEvidence.persistenceWriteCount, 1);
});

test('lifecycle setup path is excluded from business-flow priority even when it writes many first-class entities', () => {
  const indexer = new CallPathIndexerV3(structuralPriorityTopology());
  indexer.build();
  const setup = indexer.top(10).find((path) => path.entrySymbolId === 'SetupHook');
  assert.ok(setup);
  assert.equal(setup.structuralPriority, -1000000);
  assert.equal(setup.structuralPriorityEvidence.firstClassNodeCount, 0);
  assert.equal(setup.structuralPriorityEvidence.excludedFromPriority, true);
});

test('without adapter structural priority profile existing function-count ordering is preserved', () => {
  const indexer = new CallPathIndexerV3(structuralPriorityTopology({ enabled: false }));
  indexer.build();
  const top = indexer.top(10);
  assert.equal(top[0].entrySymbolId, 'DeployA');
  assert.equal(top[0].structuralPriority, undefined);
});
