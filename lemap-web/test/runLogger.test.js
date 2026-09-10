import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compactModelResult, createRunLogger, createTokenLedger, summarizeUserInteraction } from '../src/agent/runLogger.js';
import { callJsonModel, setModelCallLogger } from '../src/semantic/modelCall.js';

test('model result logging keeps decisions and token usage compact', () => {
  const summary = compactModelResult({
    purpose: 'information_need',
    model: 'deepseek-chat',
    durationMs: 231,
    usage: { prompt_tokens: 1200, completion_tokens: 84, total_tokens: 1284, prompt_cache_hit_tokens: 900 },
    finishReason: 'stop',
    parsed: { decision: 'ask_user', questionIds: ['field:year'], confidence: 0.95, reason: 'Free-text reason.', huge: 'x'.repeat(5000) }
  });
  assert.equal(summary.purpose, 'information_need');
  assert.equal(summary.tokens.total, 1284);
  assert.equal(summary.tokens.cacheHit, 900);
  assert.equal(summary.result.decision, 'ask_user');
  assert.deepEqual(summary.result.questionIds, ['field:year']);
  assert.equal(summary.result.reason, undefined);
  assert.equal(summary.result.huge, undefined);
});

test('model call logger may receive exact exchange in memory but compact JSONL summary omits it', async () => {
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
  const logged = compactModelResult(events[0]);
  assert.equal(logged.exchange, undefined);
  assert.equal(JSON.stringify(logged).includes(systemPrompt), false);
  assert.equal(JSON.stringify(logged).includes(userPrompt), false);
});

test('run JSONL omits raw goal, page title and attached URL', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-log-'));
  const logger = await createRunLogger({ baseDir: dir, goal: 'Private goal value' });
  await logger.write('attached', {
    title: 'Welcome Example Private Person',
    route: 'https://example.test/account?token=private-token',
    model: 'test-model',
    workflowId: 'workflow:1'
  });
  const content = await fs.readFile(logger.file, 'utf8');
  assert.equal(content.includes('Private goal value'), false);
  assert.equal(content.includes('Example Private Person'), false);
  assert.equal(content.includes('private-token'), false);
  assert.match(content, /goalProvided/);
  assert.match(content, /workflow:1/);
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
    question: { questionId: 'field:identifier', answerKind: 'value', label: 'Identifier', inputType: 'text' },
    interpretation: { value: 'ZXCVB1234Q', confidence: 1, reason: 'value accepted locally', local: true }
  });
  assert.equal(valueAnswer.answer, 'value provided');
  assert.equal(valueAnswer.interpretation, 'value interpreted');
  assert.equal(valueAnswer.mode, 'local');
  assert.equal(JSON.stringify(valueAnswer).includes('ZXCVB1234Q'), false);

  const modelAnswer = compactModelResult({
    purpose: 'user_choice',
    model: 'deepseek-chat',
    parsed: { selectedFieldIds: ['online'], confidence: 0.99, reason: 'Mapped choice.' }
  });
  assert.equal(JSON.stringify(modelAnswer).includes('ZXCVB1234Q'), false);

  const choiceAnswer = summarizeUserInteraction({
    question: { questionId: 'group:mode', answerKind: 'choice', label: 'Mode', options: [{ fieldId: 'online', label: 'Online' }] },
    interpretation: { selectedFieldIds: ['online'], confidence: 1, reason: 'Selected Online.', local: false }
  });
  assert.equal(choiceAnswer.mode, 'model');
  assert.deepEqual(choiceAnswer.selected, [{ fieldId: 'online', label: 'Online' }]);
});
