import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCoverageResponse } from '../server/query_v4/coverage.js';

test('normalizes descriptive coverage response', () => {
  const input = {
    e: [{ dimension: 0, field: 'productId' }],
    f: [{ fk: 25, scores: [{ dimension: 1, score: 0.8 }] }]
  };
  const expected = { e: [[0, 'productId']], f: [[25, [[1, 0.8]]]] };
  assert.deepEqual(normalizeCoverageResponse(input), expected);
});

test('accepts numeric object-map coverage response', () => {
  const input = { e: { '0': 'productId' }, f: { '25': { '1': 0.8 } } };
  const expected = { e: [[0, 'productId']], f: [[25, [[1, 0.8]]]] };
  assert.deepEqual(normalizeCoverageResponse(input), expected);
});

test('accepts legacy array coverage response', () => {
  const input = { e: [[0, 'productId']], f: [[25, [[1, 0.8]]]] };
  assert.deepEqual(normalizeCoverageResponse(input), input);
});
