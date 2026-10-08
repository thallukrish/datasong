import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAUSAL_DECIDE_SYSTEM,
  CAUSAL_SOURCE_SYSTEM,
  GOAL_DECIDE_SYSTEM
} from '../server/query_v5/goalDecisionPrompt.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const engine=fs.readFileSync(path.join(here,'../server/query_v5/queryEngine.js'),'utf8');

test('causal semantic prompt has one binary local decision and one accumulated score',()=>{
  assert.match(CAUSAL_DECIDE_SYSTEM,/er=1 only when n itself establishes a useful causal fact/);
  assert.match(CAUSAL_DECIDE_SYSTEM,/If hc="", hs MUST equal ps/);
  assert.match(CAUSAL_DECIDE_SYSTEM,/score hl \+ hc against the ORIGINAL issue/);
  assert.match(CAUSAL_DECIDE_SYSTEM,/search prediction only/);
  assert.doesNotMatch(CAUSAL_DECIDE_SYSTEM,/hardConstraints|optionalConstraints|goal sufficiency|acceptance criteria/);
});

test('causal source prompt verifies only the local fact',()=>{
  assert.match(CAUSAL_SOURCE_SYSTEM,/check only whether src directly establishes that local fact/);
  assert.match(CAUSAL_SOURCE_SYSTEM,/Source grounding is local/);
  assert.match(CAUSAL_SOURCE_SYSTEM,/Set ok=1 only when hc is non-empty/);
  assert.doesNotMatch(CAUSAL_SOURCE_SYSTEM,/"er"/);
  assert.doesNotMatch(CAUSAL_SOURCE_SYSTEM,/root-cause mechanism|hardConstraints|optionalConstraints/);
});

test('causal payload excludes generic goal ledger and duplicate facts',()=>{
  assert.match(engine,/const payload=causal\s*\? sourceBody/);
  assert.match(engine,/hl:arr\(hypothesisContributions\)\.map\(item=>item\?\.claim\|\|''\)\.filter\(Boolean\)/);
  assert.match(engine,/g:\[activeGoal\?\.text\|\|'',activeGoal\?\.failingCase\|\|''\]/);
  const causalPayloadStart=engine.indexOf('const payload=causal');
  const causalPayloadEnd=engine.indexOf('const decisionPrompt=',causalPayloadStart);
  const causalPayload=engine.slice(causalPayloadStart,causalPayloadEnd);
  assert.doesNotMatch(causalPayload,/ledgerView\(/);
  assert.doesNotMatch(causalPayload,/hardConstraints|optionalConstraints/);
});

test('causal source verification does not resend semantic candidate trees',()=>{
  const start=engine.indexOf('? sourceBody');
  const end=engine.indexOf(': {\n          q:question,',start);
  const sourcePayload=engine.slice(start,end);
  assert.doesNotMatch(sourcePayload,/\bc:/);
  assert.doesNotMatch(sourcePayload,/\bl:/);
  assert.match(engine,/if\(goal\.kind==='causal'\)decision\.picks=semanticNavigationPicks/);
});

test('causal lookahead does not duplicate candidate root semantics',()=>{
  const start=engine.indexOf('function causalSemanticLookaheadView');
  const end=engine.indexOf('function hypothesisProgress',start);
  const body=engine.slice(start,end);
  assert.match(body,/const descendants=arr\(children\.get\(state\.id\)\)/);
  assert.match(body,/return \[index,descendants\]/);
  assert.doesNotMatch(body,/\[index,walk\(state,1\)\]/);
});

test('call edges do not relabel destination functions',()=>{
  const start=engine.indexOf('function semanticNodeView');
  const end=engine.indexOf('function semanticWindowView',start);
  const body=engine.slice(start,end);
  assert.match(body,/state\?\.type==='code_symbol'\s*\? 'function'/);
  assert.doesNotMatch(body,/navigationRelationship==='calls'/);
});

test('top-level causal entries reset branch-local hypothesis state',()=>{
  assert.match(engine,/Each top-level entry is an independent causal hypothesis branch/);
  assert.match(engine,/thread\.hypothesis='';\s*thread\.hypothesisScore=0;\s*thread\.hypothesisContributions=\[\];\s*thread\.flatSteps=0/);
  assert.match(engine,/entryVisited:new Map\(\)/);
});

test('flat budget persists across sibling backtracking and never blocks strengthening',()=>{
  assert.match(engine,/hasAcceptedCausalEvidence&&progress\.trend==='flat'\?thread\.flatSteps\+1:0/);
  assert.match(engine,/if\(goal\.kind==='causal'\)return strengthens\|\|\(hasAcceptedHypothesis&&staysFlat&&canSpendFlatStep\)/);
  assert.doesNotMatch(engine,/thread\.flatSteps=Number\(top\.baseFlatSteps/);
  assert.doesNotMatch(engine,/thread\.flatSteps=Number\(parent\?\.flatSteps/);
});

test('non-causal prompt remains separate from causal prompt',()=>{
  assert.match(GOAL_DECIDE_SYSTEM,/NON-CAUSAL/);
  assert.doesNotMatch(GOAL_DECIDE_SYSTEM,/hl is authoritative|CURRENT EVIDENCE CONTRIBUTION/);
});

test('source grounding becomes the binary local evidence signal',()=>{
  assert.match(engine,/sourceBody\s*\? \(Number\(call\.parsed\?\.ok\|\|0\)===1&&currentContribution\?1:0\)/);
  assert.match(engine,/Number\(call\.parsed\?\.er\|\|0\)===1\?1:0/);
  assert.doesNotMatch(engine,/currentWindow=null/);
});
