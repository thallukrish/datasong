import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInformationNeedPrompt, normalizeInformationNeedResponse } from '../src/semantic/informationNeedPlanner.js';

test('information planner contract asks model to distinguish completed goal from blocked stop', () => {
  const prompt = buildInformationNeedPrompt({
    userGoal: 'Create a shipment',
    semanticContext: { semanticName: 'Shipment confirmation', localCompletion: 'Shipment configuration is complete.' },
    candidateQuestions: [],
    navigationCandidates: []
  });
  assert.match(prompt, /goalComplete/);
  assert.match(prompt, /completed/i);
});

test('stop can explicitly mean the original goal is complete', () => {
  const result = normalizeInformationNeedResponse({
    decision: 'stop',
    questionIds: [],
    reason: 'The requested shipment configuration is complete.',
    confidence: 0.96,
    goalComplete: true
  }, []);
  assert.equal(result.decision, 'stop');
  assert.equal(result.goalComplete, true);
});

test('unsafe or blocked stop is not mistaken for completion', () => {
  const result = normalizeInformationNeedResponse({
    decision: 'stop',
    questionIds: [],
    reason: 'No safe continuation is available.',
    confidence: 0.8,
    goalComplete: false
  }, []);
  assert.equal(result.goalComplete, false);
});
