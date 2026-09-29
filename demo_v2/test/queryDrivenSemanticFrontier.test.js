import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateLookahead,
  branchSemanticKey,
  entryCandidates,
  lookaheadFromEntry,
  mergeBranchSemantics
} from '../server/semantics/code/queryDrivenSemanticFrontier.js';

const grouped = [
  { id:'p1', symbolIds:['A','B','E'], alternatives:[] },
  { id:'p2', symbolIds:['A','C','F'], alternatives:[] },
  { id:'p3', symbolIds:['A','D','G'], alternatives:[] },
  { id:'p4', symbolIds:['X','Y'], alternatives:[] }
];
const symbols = new Map([
  ['A',{ id:'A', name:'main', entryPoint:true, sourcePath:'a.py', startLine:1, endLine:20 }],
  ['B',{ id:'B', name:'validate' }], ['C',{ id:'C', name:'load' }], ['D',{ id:'D', name:'save' }],
  ['E',{ id:'E', name:'normalize' }], ['F',{ id:'F', name:'parse' }], ['G',{ id:'G', name:'persist' }],
  ['X',{ id:'X', name:'public_api' }], ['Y',{ id:'Y', name:'run' }]
]);

test('entry-rooted lookahead preserves vertical call slices while exposing branches', () => {
  const roots = entryCandidates(grouped, symbols);
  assert.equal(roots[0].symbolId, 'A');

  const preview = lookaheadFromEntry(grouped, symbols, 'A', 2);
  assert.deepEqual(preview.children.map((item) => item.symbolId).sort(), ['B','C','D']);
  assert.equal(preview.children.find((item) => item.symbolId === 'B').children[0].symbolId, 'E');
});

test('branch semantics are persisted per deterministic call edge and attached to lookahead', () => {
  const semantics = mergeBranchSemantics({}, [
    { fromSymbolId:'A', toSymbolId:'B', purpose:'validate and normalize input', evidenceSourcePath:'a.py', evidenceStartLine:5, evidenceEndLine:7 },
    { fromSymbolId:'A', toSymbolId:'C', purpose:'load configuration' }
  ]);
  assert.equal(semantics[branchSemanticKey('A','B')].purpose, 'validate and normalize input');

  const preview = annotateLookahead(lookaheadFromEntry(grouped, symbols, 'A', 1), semantics);
  assert.equal(preview.children.find((item) => item.symbolId === 'B').edgeSemantic.purpose, 'validate and normalize input');
  assert.equal(preview.children.find((item) => item.symbolId === 'D').edgeSemantic, null);
});
