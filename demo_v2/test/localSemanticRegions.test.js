import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLocalSemanticWindow, immediateSemanticChildren } from '../server/semantics/code/localSemanticLearner.js';

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

test('semantic evidence traversal exposes regions before calls nested inside them', () => {
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
  const symbolById = new Map([[run.id, run], [helper.id, helper], [topCall.id, topCall]]);
  const explorer = { topology: { symbolById } };
  const root = stateFor(run);

  const rootChildren = immediateSemanticChildren(root, explorer);
  assert.deepEqual(rootChildren.map((child) => child.id), ['if-region', 'topCall']);

  const ifState = rootChildren.find((child) => child.id === 'if-region');
  const ifChildren = immediateSemanticChildren(ifState, explorer);
  assert.deepEqual(ifChildren.map((child) => child.id), ['try-region']);

  const tryState = ifChildren[0];
  const tryChildren = immediateSemanticChildren(tryState, explorer);
  assert.deepEqual(tryChildren.map((child) => child.id), ['helper']);

  const window = collectLocalSemanticWindow({ state: root, explorer, depth: 3 });
  assert.ok(window.links.some((link) => link.from === 'run' && link.to === 'if-region' && link.relationship === 'contains'));
  assert.ok(window.links.some((link) => link.from === 'if-region' && link.to === 'try-region' && link.relationship === 'contains'));
  assert.ok(window.links.some((link) => link.from === 'try-region' && link.to === 'helper' && link.relationship === 'calls'));
  assert.ok(window.links.some((link) => link.from === 'run' && link.to === 'topCall' && link.relationship === 'calls'));
});
