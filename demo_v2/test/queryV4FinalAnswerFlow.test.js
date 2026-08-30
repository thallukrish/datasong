import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../server/query_v4/queryEngine.js', import.meta.url), 'utf8');

test('query v4 uses deterministic connectivity and folds semantic qualification into the final answer', () => {
  assert.doesNotMatch(source, /verifyAnswerability/);
  assert.doesNotMatch(source, /query_v4_verification_reopen/);
  assert.doesNotMatch(source, /verification\?\.answerable/);
  assert.match(source, /qualifiers/);
  assert.match(source, /best-supported coherent evidence/i);
  assert.match(source, /const complete = !coverage\.missing\.length && connected/);
});
