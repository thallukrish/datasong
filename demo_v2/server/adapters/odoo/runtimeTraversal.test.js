import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runtimeObservedMethodKeys,
  selectOdooRuntimeTraversalEdges,
  selectRuntimeMethodCandidates
} from './runtimeTraversal.js';

function edge(name, { observedTarget = false } = {}) {
  return {
    relation: 'calls',
    target: {
      id: name,
      name,
      runtimeEvidence: observedTarget
        ? { observed: true, scenarioIds: ['sale-to-manufacturing'] }
        : null
    }
  };
}

test('prunes a static branch to runtime-observed call edges for the active scenario', () => {
  const a = edge('odoo19:stock.rule._run_pull');
  const b = edge('odoo19:stock.rule._run_manufacture');
  const source = {
    references: [
      { name: a.target.name, relation: 'calls', data: {} },
      {
        name: b.target.name,
        relation: 'calls',
        data: { runtimeEvidence: { observed: true, scenarioIds: ['sale-to-manufacturing'] } }
      }
    ]
  };

  const result = selectOdooRuntimeTraversalEdges({
    source,
    edges: [a, b],
    scenarioIds: ['sale-to-manufacturing']
  });

  assert.equal(result.reason, 'observed_edge');
  assert.equal(result.prunedCount, 1);
  assert.deepEqual(result.edges.map((item) => item.target.name), [b.target.name]);
});

test('uses observed target symbols when direct edge evidence is unavailable', () => {
  const a = edge('odoo19:sale.order.cancel');
  const b = edge('odoo19:sale.order._action_confirm', { observedTarget: true });
  const source = { references: [] };

  const result = selectOdooRuntimeTraversalEdges({
    source,
    edges: [a, b],
    scenarioIds: ['sale-to-manufacturing']
  });

  assert.equal(result.reason, 'observed_target');
  assert.deepEqual(result.edges.map((item) => item.target.name), [b.target.name]);
});

test('keeps all static branches when runtime evidence cannot distinguish them', () => {
  const a = edge('a');
  const b = edge('b');
  const result = selectOdooRuntimeTraversalEdges({
    source: { references: [] },
    edges: [a, b],
    scenarioIds: ['sale-to-manufacturing']
  });

  assert.equal(result.reason, 'no_runtime_match');
  assert.equal(result.edges.length, 2);
  assert.equal(result.prunedCount, 0);
});

test('prunes static framework DFS candidates from raw runtime model.method evidence', () => {
  const observedKeys = runtimeObservedMethodKeys({
    events: [
      { model: 'stock.rule', method: '_run_pull' },
      { model: 'stock.rule', method: '_get_rule' }
    ]
  });
  const result = selectRuntimeMethodCandidates([
    { modelName: 'stock.rule', methodName: '_run_manufacture' },
    { modelName: 'stock.rule', methodName: '_run_pull' },
    { modelName: 'stock.rule', methodName: '_run_push' },
    { modelName: 'stock.rule', methodName: '_get_rule' }
  ], observedKeys);

  assert.equal(result.reason, 'observed_method');
  assert.equal(result.prunedCount, 2);
  assert.deepEqual(
    result.candidates.map((item) => item.methodName),
    ['_run_pull', '_get_rule']
  );
});

test('keeps static DFS candidates when runtime does not identify any branch', () => {
  const observedKeys = runtimeObservedMethodKeys({
    events: [{ model: 'sale.order', method: 'action_confirm' }]
  });
  const candidates = [
    { modelName: 'stock.rule', methodName: '_run_pull' },
    { modelName: 'stock.rule', methodName: '_run_push' }
  ];
  const result = selectRuntimeMethodCandidates(candidates, observedKeys);
  assert.equal(result.reason, 'no_runtime_match');
  assert.deepEqual(result.candidates, candidates);
});
