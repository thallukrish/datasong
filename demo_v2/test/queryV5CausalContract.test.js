import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAUSAL_DECIDE_SYSTEM,
  GOAL_DECIDE_SYSTEM
} from '../server/query_v5/goalDecisionPrompt.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const engine=fs.readFileSync(path.join(here,'../server/query_v5/queryEngine.js'),'utf8');

test('causal semantic prompt has one binary local decision and one accumulated score',()=>{
  assert.match(CAUSAL_DECIDE_SYSTEM,/er=1 only when n itself establishes a useful causal fact/);
  assert.match(CAUSAL_DECIDE_SYSTEM,/minimal NEW fact/);
  assert.match(CAUSAL_DECIDE_SYSTEM,/already represented in hl, return er=0 and hc=""/);
  assert.match(CAUSAL_DECIDE_SYSTEM,/Return k as the indexes of the OLD hl items/);
  assert.match(CAUSAL_DECIDE_SYSTEM,/hs scores exactly: retained hl\[k\] \+ hc/);
  assert.match(CAUSAL_DECIDE_SYSTEM,/If hc="" you may still revise hl/);
  assert.match(CAUSAL_DECIDE_SYSTEM,/search prediction only/);
});

test('causal traversal has no per-node source prompt or source payload',()=>{
  assert.doesNotMatch(engine,/CAUSAL_SOURCE_SYSTEM/);
  const causalPayloadStart=engine.indexOf('const payload=causal');
  const causalPayloadEnd=engine.indexOf('const decisionPrompt=',causalPayloadStart);
  const causalPayload=engine.slice(causalPayloadStart,causalPayloadEnd);
  assert.match(causalPayload,/n:currentState\?causalSemanticNodeView/);
  assert.match(causalPayload,/c:candidates\.map/);
  assert.doesNotMatch(causalPayload,/pc:String\(proposedContribution/);
  assert.doesNotMatch(causalPayload,/src:\{/);
});

test('causal contributions are accepted from semantics without source gating',()=>{
  assert.match(engine,/evaluateCausalContribution\(\{[\s\S]*tentativeScore,[\s\S]*epsilon:HYPOTHESIS_DELTA_EPSILON/);
  assert.doesNotMatch(engine,/causalContributionNeedsSource/);
  assert.doesNotMatch(engine,/sourceDroppedContribution/);
  assert.doesNotMatch(engine,/CAUSAL_CONTRIBUTION_SOURCE/);
});

test('high-confidence complete causal list is localized once and resolves without mandatory counterfactual',()=>{
  assert.match(engine,/sourceLocalizationByHypothesis:new Map\(\)/);
  assert.match(engine,/hypothesisContributions:acceptedCausalContributions/);
  assert.match(engine,/CAUSAL_SOURCE_LOCALIZE_SYSTEM/);
  assert.match(engine,/\{q:question,hl,sources\}/);
  assert.match(engine,/CAUSAL_ACCEPT_SCORE = 0\.8/);
  assert.match(engine,/Number\(decision\.hypothesisScore\|\|0\)>=CAUSAL_ACCEPT_SCORE/);
  assert.match(engine,/causalSourceCoverageComplete\(ranges,acceptedCausalContributions\.length\)/);
  assert.match(engine,/localizedRangeStates\(rawCausalEvidence,ranges\)/);
  assert.match(engine,/action:'CAUSAL_SOURCE_LOCALIZED'/);
  assert.match(engine,/action:'CAUSAL_HYPOTHESIS_ACCEPTED'/);
  assert.doesNotMatch(engine,/decision\.hypothesisScore=hard\.length/);
  assert.doesNotMatch(engine,/Counterfactual intervention failed to validate this causal diagnosis/);
});

test('causal lookahead does not duplicate candidate root semantics',()=>{
  const start=engine.indexOf('function causalSemanticLookaheadView');
  const end=engine.indexOf('function hypothesisProgress',start);
  const body=engine.slice(start,end);
  assert.match(body,/const descendants=arr\(children\.get\(state\.id\)\)/);
  assert.match(body,/return \[index,descendants\]/);
  assert.doesNotMatch(body,/\[index,walk\(state,1\)\]/);
});

test('top-level causal entries reset branch-local hypothesis state',()=>{
  assert.match(engine,/Each top-level entry is an independent causal hypothesis branch/);
  assert.match(engine,/thread\.hypothesis='';\s*thread\.hypothesisScore=0;\s*thread\.hypothesisContributions=\[\]/);
  assert.match(engine,/entryVisited:new Map\(\)/);
});

test('non-causal prompt remains separate from causal prompt',()=>{
  assert.match(GOAL_DECIDE_SYSTEM,/NON-CAUSAL/);
  assert.doesNotMatch(GOAL_DECIDE_SYSTEM,/hl is authoritative|CURRENT EVIDENCE CONTRIBUTION/);
});

test('causal visited state is keyed by node plus accepted hypothesis state',()=>{
  assert.match(engine,/function semanticVisitKey\(/);
  assert.match(engine,/semanticVisitKey\(state,goal\.kind,thread\.hypothesisContributions\)/);
  assert.match(engine,/semanticVisitKey\(child,goal\.kind,thread\.hypothesisContributions\)/);
  assert.match(engine,/semanticVisitKey\(id,thread\.goal\.kind,thread\.hypothesisContributions\)/);
});

test('causal source localization requires coverage for every hl contribution',()=>{
  assert.match(engine,/contributionIndexes/);
  assert.match(engine,/function causalSourceCoverageComplete/);
  assert.match(engine,/for\(let index=0;index<contributionCount;index\+=1\)/);
});

test('causal hl is a moving explanatory set selected by retained indexes',()=>{
  assert.match(engine,/retainedContributionIndexes/);
  assert.match(engine,/retainCausalContributions\(priorContributions,requestedIndexes\)/);
  assert.match(engine,/action:'CAUSAL_HYPOTHESIS_REVISED'/);
  assert.match(engine,/decision\.hypothesis=causalHypothesisText\(revised\)/);
  assert.match(engine,/decision\.hypothesisScore=Math\.max\(priorScore,tentativeScore\)/);
});


test('causal navigation follows non-weakening candidates and has no flat-hop budget',()=>{
  assert.match(engine,/const weakens=expectedScore<currentScore-HYPOTHESIS_DELTA_EPSILON/);
  assert.match(engine,/if\(goal\.kind==='causal'\)return !weakens/);
  assert.match(engine,/if\(!causal&&!\(score>0\)\)continue/);
  assert.doesNotMatch(engine,/MAX_FLAT_STEPS/);
  assert.doesNotMatch(engine,/flatSteps/);
  assert.doesNotMatch(engine,/baseFlatSteps/);
  assert.doesNotMatch(engine,/HYPOTHESIS_FLAT/);
  assert.doesNotMatch(engine,/hasLookahead/);
});
