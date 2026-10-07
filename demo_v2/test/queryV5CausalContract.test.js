import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOAL_DECIDE_SYSTEM } from '../server/query_v5/goalDecisionPrompt.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const engine=fs.readFileSync(path.join(here,'../server/query_v5/queryEngine.js'),'utf8');

test('causal decision prompt uses local relevance and accumulated hypothesis scoring',()=>{
  assert.match(GOAL_DECIDE_SYSTEM,/LEVEL 1 — CURRENT EVIDENCE RELEVANCE/);
  assert.match(GOAL_DECIDE_SYSTEM,/LEVEL 2 — OVERALL HYPOTHESIS ALIGNMENT/);
  assert.match(GOAL_DECIDE_SYSTEM,/Navigation is driven by the expected CHANGE in the OVERALL hypothesis/);
  assert.match(GOAL_DECIDE_SYSTEM,/pc\nFor SOURCE VERIFICATION only/);
  assert.match(GOAL_DECIDE_SYSTEM,/hl is the authoritative causal hypothesis/);
  assert.doesNotMatch(GOAL_DECIDE_SYSTEM,/deciding that the prior h is correct/);
  assert.doesNotMatch(GOAL_DECIDE_SYSTEM,/source-grounded h/);
});

test('call edges do not relabel destination functions for the model',()=>{
  const start=engine.indexOf('function semanticNodeView');
  const end=engine.indexOf('function semanticWindowView',start);
  const body=engine.slice(start,end);
  assert.match(body,/state\?\.type==='code_symbol'\s*\? 'function'/);
  assert.doesNotMatch(body,/navigationRelationship==='calls'/);
});

test('source verification receives the exact semantic contribution as pc',()=>{
  assert.match(engine,/const semanticProposedContribution=String\(decision\.contribution\|\|''\)\.trim\(\)/);
  assert.match(engine,/proposedContribution:semanticProposedContribution/);
  assert.match(engine,/pc:String\(proposedContribution\|\|''\)/);
});

test('generic h-based evidence reselect is not used for causal source verification',()=>{
  assert.match(engine,/sourceBody&&evidenceStates\.length&&activeGoal\?\.kind!=='causal'/);
});

test('causal candidate scoring is predictive rather than requiring established evidence',()=>{
  assert.match(GOAL_DECIDE_SYSTEM,/This is a SEARCH PREDICTION, not established evidence/);
  assert.match(GOAL_DECIDE_SYSTEM,/You are not required to already prove the candidate's mechanism before giving it a positive score/);
  assert.match(GOAL_DECIDE_SYSTEM,/When hl is empty and ps=0, a promising candidate may still receive a strong positive expectedHypothesisScore/);
  assert.match(GOAL_DECIDE_SYSTEM,/Do not set candidates to zero merely because no contribution has yet been accepted/);
});
