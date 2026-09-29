import test from 'node:test';
import assert from 'node:assert/strict';
import { Pass1ArcScheduler } from '../server/pass1ArcScheduler.js';

function fakeExplorer() {
  return {
    state: {
      step: 1,
      pass1Scheduler: { activeArcId: '', nextArcNumber: 1, nextHypothesisNumber: 1, decisions: [], fitHistory: [], hypotheses: [] },
      pass1Arcs: []
    },
    _schedulerObservation: null,
    activeStoryId: ''
  };
}

test('code_flow is admitted and schedulable without business qualification', () => {
  const explorer = fakeExplorer();
  const scheduler = new Pass1ArcScheduler(explorer);
  const arc = scheduler.createArc({
    title: 'Parse and normalize input',
    qualification: 'code_flow',
    semanticKind: 'code_flow',
    confidence: 0.7
  }, { id: 'path-1' });

  assert.ok(arc);
  assert.equal(arc.qualification, 'code_flow');
  assert.equal(arc.semanticKind, 'code_flow');
  assert.equal(scheduler.chooseNextArc(arc.id)?.id, arc.id);
});

test('enterprise arc remains the default qualification', () => {
  const explorer = fakeExplorer();
  const scheduler = new Pass1ArcScheduler(explorer);
  const arc = scheduler.createArc({
    title: 'Place order',
    qualification: 'business_use_case',
    qualifiesAsBusinessUseCase: true,
    confidence: 0.8
  }, { id: 'path-2' });

  assert.equal(arc.qualification, 'business_use_case');
  assert.equal(arc.semanticKind, 'business_workflow');
});


test('generic code evidence can include source bodies for representative and alternate symbols', async () => {
  const { RepositoryExplorer } = await import('../server/repositoryExplorer.js');
  const topology = {
    symbolById: new Map([
      ['a', { id: 'a', name: 'parse', symbolKind: 'function', signature: 'function parse(input)', sourcePath: 'src/a.js', startLine: 1, endLine: 3, body: 'function parse(input) { return normalize(input); }', references: [{ name: 'normalize', relation: 'calls' }] }],
      ['b', { id: 'b', name: 'normalize', symbolKind: 'function', signature: 'function normalize(input)', sourcePath: 'src/b.js', startLine: 1, endLine: 3, body: 'function normalize(input) { return input.trim(); }', references: [] }]
    ])
  };
  const explorer = new RepositoryExplorer({ topology, dataRoot: '.', onState() {} });
  explorer.setSemanticProfile('code');
  const evidence = explorer.codeFlowEvidence({ symbolIds: ['a'], alternatives: [{ symbolIds: ['b'] }] });

  assert.deepEqual(evidence.map((item) => item.symbolId), ['a', 'b']);
  assert.match(evidence[0].signature, /input/);
  assert.match(evidence[0].body, /normalize/);
  assert.equal(evidence[1].sourcePath, 'src/b.js');
});


test('repository explorer construction does not load or hydrate persisted semantic maps', async () => {
  const { RepositoryExplorer } = await import('../server/repositoryExplorer.js');
  let prepares = 0;
  const topology = { symbolById:new Map(), async prepare() { prepares += 1; return {}; } };
  const explorer = new RepositoryExplorer({ topology, dataRoot: '.', onState() {} });

  assert.equal(explorer.state?.repoUrl || '', '');
  assert.equal((explorer.state?.pass1Arcs || []).length, 0);
  assert.equal(Object.keys(explorer.state?.semanticObjects || {}).length, 0);
  assert.equal(prepares, 0);
  assert.deepEqual(await explorer.startupHydration, { hydrated:false, reason:'startup_inert' });
});
