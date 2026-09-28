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
