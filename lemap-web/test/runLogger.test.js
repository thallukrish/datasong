import test from 'node:test';
import assert from 'node:assert/strict';
import { compactModelResult, summarizeUserInteraction } from '../src/agent/runLogger.js';

test('model result logging keeps decisions and token usage compact', () => {
  const summary = compactModelResult({
    purpose: 'information_need',
    model: 'deepseek-chat',
    durationMs: 231,
    usage: { prompt_tokens: 1200, completion_tokens: 84, total_tokens: 1284, prompt_cache_hit_tokens: 900 },
    finishReason: 'stop',
    parsed: { decision: 'ask_user', questionIds: ['field:year'], confidence: 0.95, reason: 'Assessment year is required.', huge: 'x'.repeat(5000) }
  });
  assert.equal(summary.purpose, 'information_need');
  assert.equal(summary.tokens.total, 1284);
  assert.equal(summary.tokens.cacheHit, 900);
  assert.equal(summary.result.decision, 'ask_user');
  assert.deepEqual(summary.result.questionIds, ['field:year']);
  assert.equal(summary.result.huge, undefined);
});

test('user interaction logging does not persist free-text values', () => {
  const valueAnswer = summarizeUserInteraction({
    question: { questionId: 'field:pan', answerKind: 'value', label: 'PAN', inputType: 'text' },
    interpretation: { value: 'ABCDE1234F', confidence: 0.99, reason: 'User supplied PAN ABCDE1234F.' }
  });
  assert.equal(valueAnswer.answer, 'value provided');
  assert.equal(valueAnswer.interpretation, 'value interpreted');
  assert.equal(JSON.stringify(valueAnswer).includes('ABCDE1234F'), false);

  const modelAnswer = compactModelResult({
    purpose: 'user_answer',
    model: 'deepseek-chat',
    parsed: { value: 'ABCDE1234F', confidence: 0.99, reason: 'Mapped PAN ABCDE1234F.' }
  });
  assert.equal(JSON.stringify(modelAnswer).includes('ABCDE1234F'), false);
  assert.equal(modelAnswer.result.value, 'value provided');

  const choiceAnswer = summarizeUserInteraction({
    question: { questionId: 'group:mode', answerKind: 'choice', label: 'ITR Mode', options: [{ fieldId: 'online', label: 'Online' }] },
    interpretation: { selectedFieldIds: ['online'], confidence: 1, reason: 'Selected Online.' }
  });
  assert.deepEqual(choiceAnswer.selected, [{ fieldId: 'online', label: 'Online' }]);
});
