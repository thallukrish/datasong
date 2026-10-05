import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLocalSemanticWindow } from '../server/semantics/code/localSemanticLearner.js';

function stateFor(symbol) {
  return {
    id: symbol.id,
    type: 'code_symbol',
    name: symbol.name,
    symbolId: symbol.id,
    sourcePath: symbol.sourcePath,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    body: symbol.body
  };
}

test('semantic windows expose regions for short functions and keep calls in the smallest enclosing region', () => {
  const helper = {
    id: 'helper',
    name: 'Worker.helper',
    sourcePath: 'worker.py',
    startLine: 30,
    endLine: 32,
    body: 'def helper(self):\n    return 1',
    references: [],
    regions: []
  };
  const topCall = {
    id: 'topCall',
    name: 'Worker.top_call',
    sourcePath: 'worker.py',
    startLine: 40,
    endLine: 42,
    body: 'def top_call(self):\n    return 2',
    references: [],
    regions: []
  };
  const run = {
    id: 'run',
    name: 'Worker.run',
    sourcePath: 'worker.py',
    startLine: 1,
    endLine: 20,
    body: 'def run(self, value): ...',
    references: [
      { relation: 'calls', targetSymbolId: 'helper', line: 6 },
      { relation: 'calls', targetSymbolId: 'topCall', line: 18 }
    ],
    regions: [
      {
        id: 'if-region',
        kind: 'if',
        startLine: 3,
        endLine: 12,
        parentRegionId: null,
        body: 'if value:\n    ...'
      },
      {
        id: 'try-region',
        kind: 'try',
        startLine: 5,
        endLine: 9,
        parentRegionId: 'if-region',
        body: 'try:\n    self.helper()'
      }
    ]
  };

  const explorer = {
    topology: {
      symbolById: new Map([
        [run.id, run],
        [helper.id, helper],
        [topCall.id, topCall]
      ])
    }
  };

  const window = collectLocalSemanticWindow({
    state: stateFor(run),
    explorer,
    depth: 3,
    includeRootRegions: true,
    includeCallFrontier: true
  });

  const edges = window.links.map(link => [link.from, link.to, link.relationship]);

  assert.ok(edges.some(edge => edge[0] === 'run' && edge[1] === 'if-region' && edge[2] === 'contains'));
  assert.ok(edges.some(edge => edge[0] === 'if-region' && edge[1] === 'try-region' && edge[2] === 'contains'));
  assert.ok(edges.some(edge => edge[0] === 'try-region' && edge[1] === 'helper' && edge[2] === 'calls'));
  assert.ok(edges.some(edge => edge[0] === 'run' && edge[1] === 'topCall' && edge[2] === 'calls'));

  assert.ok(!edges.some(edge => edge[0] === 'run' && edge[1] === 'helper' && edge[2] === 'calls'));
  assert.ok(!edges.some(edge => edge[0] === 'if-region' && edge[1] === 'helper' && edge[2] === 'calls'));
});
