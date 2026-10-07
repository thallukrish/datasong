import test from 'node:test';
import assert from 'node:assert/strict';
import {
  causalHypothesisText,
  evaluateCausalContribution
} from '../server/query_v5/causalEvidence.js';

test('causal evidence uses separate local relevance and global hypothesis score', () => {
  const prior=[{claim:'A'}];

  const accepted=evaluateCausalContribution({
    priorContributions:prior,
    priorScore:0.55,
    contribution:'B',
    evidenceRelevance:0.9,
    tentativeScore:0.72,
    inspectedSource:true,
    sourceGrounded:true
  });
  assert.equal(accepted.accepted,true);
  assert.equal(accepted.rejected,false);
  assert.equal(accepted.score,0.72);

  const locallyRelevantButGloballyWorse=evaluateCausalContribution({
    priorContributions:prior,
    priorScore:0.72,
    contribution:'C',
    evidenceRelevance:0.95,
    tentativeScore:0.40,
    inspectedSource:true,
    sourceGrounded:true
  });
  assert.equal(locallyRelevantButGloballyWorse.accepted,false);
  assert.equal(locallyRelevantButGloballyWorse.rejected,true);
  assert.equal(locallyRelevantButGloballyWorse.score,0.72);
});

test('causal evidence rejects locally unimportant contributions before accumulation', () => {
  const result=evaluateCausalContribution({
    priorContributions:[],
    priorScore:0,
    contribution:'weak guess',
    evidenceRelevance:0,
    tentativeScore:0.8
  });

  assert.equal(result.accepted,false);
  assert.equal(result.rejected,true);
  assert.equal(result.score,0);
});


test('causal hypothesis display is derived only from accepted contributions', () => {
  assert.equal(
    causalHypothesisText([{claim:'A'},{claim:'B'}]),
    'A -> B'
  );
});

test('accepted causal score never decreases',()=>{
  const flat=evaluateCausalContribution({
    priorContributions:[{claim:'A'}],
    priorScore:0.72,
    contribution:'B',
    evidenceRelevance:0.9,
    tentativeScore:0.70,
    inspectedSource:true,
    sourceGrounded:true,
    epsilon:0.03
  });
  assert.equal(flat.accepted,true);
  assert.equal(flat.score,0.72);
});
