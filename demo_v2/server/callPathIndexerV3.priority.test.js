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
