import test from 'node:test';
import assert from 'node:assert/strict';
import { withCallPathAccess } from '../server/explorer/callPathAccess.js';

class Base {
  constructor(topology) { this.topology = topology; }
}

const Explorer = withCallPathAccess(Base);

test('reuses deterministic grouped call paths while scheduling multiple arcs', () => {
  let topCalls = 0;
  const rankedPaths = [
    { id:'callpath:1', normalizedFlowTokens:['a'] },
    { id:'callpath:2', normalizedFlowTokens:['b'] }
  ];
  const topology = {
    callPathIndexer:{ rankedPaths },
    topCallPaths:() => {
      topCalls += 1;
      return rankedPaths;
    }
  };
  const explorer = new Explorer(topology);

  assert.equal(explorer.groupedPathForArc({ callPathId:'callpath:1' })?.id, 'callpath:1');
  assert.equal(explorer.groupedPathForArc({ callPathId:'callpath:2' })?.id, 'callpath:2');
  assert.equal(topCalls, 1, 'grouped call-path computation should be reused across workflow handoffs');
});

test('invalidates grouped call path cache when topology index changes', () => {
  let topCalls = 0;
  const topology = {
    callPathIndexer:{ rankedPaths:[{ id:'callpath:1' }] },
    topCallPaths:() => { topCalls += 1; return topology.callPathIndexer.rankedPaths; }
  };
  const explorer = new Explorer(topology);

  explorer.groupedPathForArc({ callPathId:'callpath:1' });
  topology.callPathIndexer = { rankedPaths:[{ id:'callpath:2' }] };
  assert.equal(explorer.groupedPathForArc({ callPathId:'callpath:2' })?.id, 'callpath:2');
  assert.equal(topCalls, 2);
});
