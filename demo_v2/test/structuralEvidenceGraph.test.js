import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkflowGraph, mergeStructuralEvidenceNodes } from '../server/semantics/code/structuralEvidenceGraph.js';

test('workflow graph reuses existing ordered call-path symbol ids', () => {
  const symbols = [
    { id: 'A', name: 'A', sourcePath: 'a.py', startLine: 1, endLine: 5 },
    { id: 'B', name: 'B', sourcePath: 'b.py', startLine: 10, endLine: 15 },
    { id: 'C', name: 'C', sourcePath: 'c.py', startLine: 20, endLine: 25 }
  ];
  const groupedPaths = [{
    id: 'callpath:0',
    symbolIds: ['A', 'B', 'C'],
    branchVariantCount: 1,
    alternateEntranceCount: 0
  }];
  const entityLinks = [
    { functionId: 'A', targetId: 'entity:X' },
    { functionId: 'B', targetId: 'entity:X' },
    { functionId: 'C', targetId: 'entity:Y' }
  ];

  const graph = buildWorkflowGraph({ groupedPaths, symbols, entityLinks });
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].type, 'workflow');
  assert.equal(graph.nodes[0].details.entryFunctionId, 'A');
  assert.equal(graph.nodes[0].details.exitFunctionId, 'C');
  assert.equal(graph.nodes[0].details.functionCount, 3);
  assert.equal(graph.nodes[0].details.entityCount, 2);
  assert.deepEqual(graph.nodes[0].links.map((link) => [link.id, link.relationship]), [
    ['A', 'contains'], ['B', 'contains'], ['C', 'contains']
  ]);
  assert.deepEqual(graph.workflowLinks.map((link) => link.ordinal), [0, 1, 2]);
});

test('flat structural evidence graph merges shared function nodes without duplicating links', () => {
  const merged = mergeStructuralEvidenceNodes(
    [{ id: 'A', type: 'function', details: { name: 'A' }, links: [{ id: 'B', relationship: 'calls' }] }],
    [{ id: 'A', type: 'function', details: { sourcePath: 'a.py' }, links: [{ id: 'entity:X', relationship: 'read' }] }]
  );
  const a = merged.find((node) => node.id === 'A');
  assert.equal(merged.length, 1);
  assert.equal(a.details.name, 'A');
  assert.equal(a.details.sourcePath, 'a.py');
  assert.equal(a.links.length, 2);
});
