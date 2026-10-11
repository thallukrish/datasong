import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCompactCallFlows } from '../server/semantics/code/compactCallFlows.js';

function fn(id,targets=[]){
  return {
    id,
    name:id,
    executable:true,
    references:targets.map(targetSymbolId=>({
      relation:'calls',
      targetSymbolId
    }))
  };
}

test('compact flows split branches and convergences without enumerating root-to-leaf combinations',()=>{
  const symbols=[
    fn('A',['B']),
    fn('B',['C']),
    fn('C',['D','F']),
    fn('D',['E']),
    fn('E',['H']),
    fn('F',['G']),
    fn('G',['H']),
    fn('H',['I']),
    fn('I',[])
  ];

  const graph=buildCompactCallFlows({symbols});
  const sequences=graph.paths.map(path=>path.symbolIds.join('>'));

  assert.equal(graph.functionCount,9);
  assert.equal(graph.edgeCount,9);

  assert.deepEqual(new Set(sequences),new Set([
    'A>B>C',
    'C>D>E>H',
    'C>F>G>H',
    'H>I'
  ]));

  // Four compact segments represent the same branching call graph that would
  // otherwise create multiple complete root-to-leaf path combinations.
  assert.equal(graph.paths.length,4);
});

test('compact flows consume a pure cycle once',()=>{
  const symbols=[
    fn('A',['B']),
    fn('B',['C']),
    fn('C',['A'])
  ];

  const graph=buildCompactCallFlows({symbols});
  assert.equal(graph.edgeCount,3);
  assert.equal(graph.paths.length,1);
  assert.ok(graph.paths[0].symbolIds.length>=2);
});
