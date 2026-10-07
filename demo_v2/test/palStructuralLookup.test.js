import test from 'node:test';
import assert from 'node:assert/strict';
import { prefixMatchesFromCanonicalIndexes } from '../server/query_v5/palStructuralLookup.js';

test('PAL prefix lookup scopes canonical name values by structural type', () => {
  const uniqueIndex = {
    type: ['function', 'call', 'assignment'],
    name: ['separability_matrix', 'separable_call', 'separate_value', '_separable']
  };
  const valuesIndex = {
    type: [
      ['0-1', 'function'],
      ['2', 'call'],
      ['3', 'assignment']
    ],
    name: [
      ['0', 'separability_matrix'],
      ['2', 'separable_call'],
      ['3', 'separate_value'],
      ['1', '_separable']
    ]
  };

  const matches = prefixMatchesFromCanonicalIndexes({
    uniqueIndex,
    valuesIndex,
    type: 'function',
    value: 'separab*'
  });

  assert.deepEqual(matches, [
    { name: 'separability_matrix', rows: [0] }
  ]);
});

test('PAL prefix lookup keeps all matching types when type is wildcard', () => {
  const uniqueIndex = {
    type: ['function', 'call'],
    name: ['separability_matrix', 'separable_call']
  };
  const valuesIndex = {
    type: [
      ['0', 'function'],
      ['1', 'call']
    ],
    name: [
      ['0', 'separability_matrix'],
      ['1', 'separable_call']
    ]
  };

  const matches = prefixMatchesFromCanonicalIndexes({
    uniqueIndex,
    valuesIndex,
    type: '*',
    value: 'separab*'
  });

  assert.deepEqual(matches, [
    { name: 'separability_matrix', rows: [0] },
    { name: 'separable_call', rows: [1] }
  ]);
});
