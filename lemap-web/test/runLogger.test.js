import test from 'node:test';
import assert from 'node:assert/strict';
import { compactModelResult, createTokenLedger, summarizeUserInteraction } from '../src/agent/runLogger.js';
import { callJsonModel, setModelCallLogger } from '../src/semantic/modelCall.js';

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

test('model call logger receives and persists the exact request and response payloads', async () => {
  const events = [];
  const apiCalls = [];
  const client = {
    chat: {
      completions: {
        create: async (request) => {
          apiCalls.push(request);
          return {
            choices: [{ message: { content: '{"entities":[{"id":"field:year","semantic":{"required":true}}]}' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
          };
        }
      }
    }
  };

  const systemPrompt = 'SYSTEM exact prompt';
  const userPrompt = 'MODE web-entity-semantics-v1\nUSER exact prompt';
  setModelCallLogger(async (event) => events.push(structuredClone(event)));
  try {
    await callJsonModel({ client, model: 'deepseek-chat', systemPrompt, userPrompt });
  } finally {
    setModelCallLogger(null);
  }

  assert.equal(apiCalls.length, 1);
  assert.deepEqual(apiCalls[0].messages, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].systemPrompt, systemPrompt);
  assert.equal(events[0].userPrompt, userPrompt);
  assert.equal(events[0].raw, '{"entities":[{"id":"field:year","semantic":{"required":true}}]}');
  assert.deepEqual(events[0].parsed, { entities: [{ id: 'field:year', semantic: { required: true } }] });

  const logged = compactModelResult(events[0]);
  assert.equal(logged.exchange.systemPrompt, systemPrompt);
  assert.equal(logged.exchange.userPrompt, userPrompt);
  assert.equal(logged.exchange.rawResponse, events[0].raw);
  assert.deepEqual(logged.exchange.parsedResponse, events[0].parsed);
});

test('token ledger aggregates model usage by purpose and total', () => {
  const ledger = createTokenLedger();
  ledger.add({ purpose: 'local_entity', tokens: { prompt: 1000, completion: 100, total: 1100, cacheHit: 500 } });
  ledger.add({ purpose: 'local_entity', tokens: { prompt: 800, completion: 80, total: 880, cacheHit: 400 } });
  ledger.add({ purpose: 'navigation_scout', tokens: { prompt: 600, completion: 60, total: 660, cacheHit: 0 } });

  const summary = ledger.summary();
  assert.equal(summary.total.calls, 3);
  assert.equal(summary.total.tokens, 2640);
  assert.equal(summary.total.cacheHit, 900);
  assert.equal(summary.byPurpose.local_entity.calls, 2);
  assert.equal(summary.byPurpose.local_entity.tokens, 1980);
});

test('user interaction logging does not persist free-text values and records local handling', () => {
  const valueAnswer = summarizeUserInteraction({
    question: { questionId: 'field:pan', answerKind: 'value', label: 'PAN', inputType: 'text' },
    interpretation: { value: 'ABCDE1234F', confidence: 1, reason: 'value accepted locally', local: true }
  });
  assert.equal(valueAnswer.answer, 'value provided');
  assert.equal(valueAnswer.interpretation, 'value interpreted');
  assert.equal(valueAnswer.mode, 'local');
  assert.equal(JSON.stringify(valueAnswer).includes('ABCDE1234F'), false);

  const modelAnswer = compactModelResult({
    purpose: 'user_choice',
    model: 'deepseek-chat',
    parsed: { selectedFieldIds: ['online'], confidence: 0.99, reason: 'Mapped choice.' }
  });
  assert.equal(JSON.stringify(modelAnswer).includes('ABCDE1234F'), false);

  const choiceAnswer = summarizeUserInteraction({
    question: { questionId: 'group:mode', answerKind: 'choice', label: 'ITR Mode', options: [{ fieldId: 'online', label: 'Online' }] },
    interpretation: { selectedFieldIds: ['online'], confidence: 1, reason: 'Selected Online.', local: false }
  });
  assert.equal(choiceAnswer.mode, 'model');
  assert.deepEqual(choiceAnswer.selected, [{ fieldId: 'online', label: 'Online' }]);
});
