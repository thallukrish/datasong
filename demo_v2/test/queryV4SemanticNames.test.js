import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCoverageResponse } from '../server/query_v4/coverage.js';

test('maps named coverage decisions to internal indexes', () => {
  const dimensions = ['product', 'sales', 'region'];
  const fks = [
    { target:'Invoice', relationship:'invoice', keyMaps:[] },
    { target:'Geo', relationship:'geo', keyMaps:[] }
  ];
  const input = {
    e:[{ dimension:'region', field:'geoName' }],
    f:[{ target:'Geo', relationship:'geo', scores:[{ dimension:'region', score:0.8 }] }]
  };
  assert.deepEqual(normalizeCoverageResponse(input, dimensions, fks), {
    e:[[2, 'geoName']],
    f:[[1, [[2, 0.8]]]]
  });
});
