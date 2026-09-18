import test from 'node:test';
import assert from 'node:assert/strict';
import { CallPathIndexerV3 } from './callPathIndexerV3.js';

function firstClassSymbol(id, modelName, references = []) {
  return {
    id,
    name: modelName,
    references,
    odooExecution: {
      firstClassEntity: true,
      firstClassMethod: true,
      modelName
    }
  };
}

test('orders by distinct first-class node count before structural score', () => {
  const noisyWrites = Array.from({ length: 30 }, (_, index) => ({
    name: `entity.${index}`,
    relation: 'writes',
    data: { operationKind: 'persistence', persistenceKind: 'odoo_orm', crud: 'update' }
  }));

  const symbols = [
    firstClassSymbol('a', 'A'),
    firstClassSymbol('b', 'B'),
    firstClassSymbol('c', 'C'),
    firstClassSymbol('x', 'X', noisyWrites),
    firstClassSymbol('y', 'Y')
  ];

  const topology = {
    symbolById: new Map(symbols.map((symbol) => [symbol.id, symbol])),
    callPathPriorityProfile() {
      return {
        version: 'test',
        firstClassNodes: {
          metadataPath: 'odooExecution',
          flags: ['firstClassEntity', 'firstClassMethod'],
          identityField: 'modelName'
        },
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
  };

  const indexer = new CallPathIndexerV3(topology);
  indexer.rankedPaths = [
    { id: 'two-first-class-but-noisy', symbolIds: ['x', 'y'], relations: ['calls'], functionCount: 2 },
    { id: 'three-first-class', symbolIds: ['a', 'b', 'c'], relations: ['calls', 'calls'], functionCount: 3 }
  ];

  const ordered = indexer.orderedPaths();

  assert.equal(
    ordered.paths[0].id,
    'three-first-class',
    '3 distinct first-class entities must outrank 2 regardless of secondary score'
  );
});


test('uses runtime observations to break ties between paths with equal first-class count', () => {
  const a = firstClassSymbol('a2', 'A2');
  const b = firstClassSymbol('b2', 'B2');
  const c = firstClassSymbol('c2', 'C2');
  const d = firstClassSymbol('d2', 'D2');

  a.references.push({
    name: 'B2',
    relation: 'calls',
    data: {
      sourceModel: 'A2',
      targetModel: 'B2',
      runtimeEvidence: { observed: true, observationCount: 1, scenarioIds: ['sale-to-manufacturing'] }
    }
  });
  c.references.push({
    name: 'D2',
    relation: 'calls',
    data: { sourceModel: 'C2', targetModel: 'D2' }
  });

  a.runtimeEvidence = { observed: true, observationCount: 1, scenarioIds: ['sale-to-manufacturing'] };
  b.runtimeEvidence = { observed: true, observationCount: 1, scenarioIds: ['sale-to-manufacturing'] };

  const symbols = [a, b, c, d];
  const topology = {
    symbolById: new Map(symbols.map((symbol) => [symbol.id, symbol])),
    callPathPriorityProfile() {
      return {
        version: 'test',
        firstClassNodes: {
          metadataPath: 'odooExecution',
          flags: ['firstClassEntity', 'firstClassMethod'],
          identityField: 'modelName'
        },
        weights: { firstClassNode: 100 }
      };
    }
  };

  const indexer = new CallPathIndexerV3(topology);
  indexer.rankedPaths = [
    { id: 'static-only', symbolIds: ['c2', 'd2'], relations: ['calls'], functionCount: 2 },
    { id: 'runtime-observed', symbolIds: ['a2', 'b2'], relations: ['calls'], functionCount: 2 }
  ];

  const ordered = indexer.orderedPaths();
  assert.equal(ordered.paths[0].id, 'runtime-observed');
  assert.equal(ordered.priorityById.get('runtime-observed').evidence.runtimeObservedEdgeCount, 1);
});
