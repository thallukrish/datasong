import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueryLearningOrchestrator } from './queryLearningOrchestrator.js';
import { assessPlanForLearning } from './learningAssessment.js';

test('unmet plan step produces an evidence-scoped handoff', () => {
  const result = assessPlanForLearning({
    question:'Why is production constrained?', logicalRequest:{grain:'manufacturing order',steps:[
      {action:'Identify orders',requires:['orders']},
      {action:'Establish capacity',requires:['capacity'],relation:'orders to work centers'}
    ]}, coverage:{missing:['capacity']},connectivity:{connected:false},
    accepted:[{entity:'mrp.production',covered:[{dimension:'orders',field:'name'}]}]
  });
  assert.equal(result.complete,false);
  assert.equal(result.stepAssessment[0].status,'supported');
  assert.equal(result.stepAssessment[1].status,'unsupported');
  assert.deepEqual(result.learningRequest.targets[0].missingConcepts,['capacity']);
});

test('answerable query bypasses learning', async () => {
  let called = 0;
  const run = createQueryLearningOrchestrator({runQuery:async()=>({status:'answered'}),learnTargeted:async()=>{called++;}});
  assert.equal((await run({question:'q',autoLearn:true})).status,'answered');
  assert.equal(called,0);
});

test('missing learner reports handoff without pretending to run fixtures', async () => {
  const run = createQueryLearningOrchestrator({runQuery:async()=>({status:'needs_learning',learningRequest:{targets:[{stepId:'S1'}]}})});
  const result = await run({question:'q',autoLearn:true});
  assert.equal(result.learningState,'awaiting_learner');
});

test('learner with no new persisted evidence does not retry query', async () => {
  let queryCalls=0;
  const run = createQueryLearningOrchestrator({
    runQuery:async()=>{queryCalls++;return {status:'needs_learning',learningRequest:{targets:[{stepId:'S1'}]}};},
    learnTargeted:async()=>({changed:false})
  });
  assert.equal((await run({question:'q',autoLearn:true})).learningState,'no_new_evidence');
  assert.equal(queryCalls,1);
});
