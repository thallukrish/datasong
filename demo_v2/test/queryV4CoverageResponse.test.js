import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEntityCoverage, normalizeCoverageResponse } from '../server/query_v4/coverage.js';

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

test('normalizes array follow response with nested scores wrapper', () => {
  const input = { e: [], f: [[8, { scores:[[2, 0.8]] }]] };
  const expected = { e:[], f:[[8, [[2, 0.8]]]] };
  assert.deepEqual(normalizeCoverageResponse(input), expected);
});

test('logs raw and normalized entity model decisions without changing coverage behavior', async () => {
  const events = [];
  const response = { e: [], f: [{ fk:0, scores:[{ dimension:0, score:0.8 }] }] };
  const client = {
    chat:{ completions:{ create:async () => ({
      choices:[{ message:{ content:JSON.stringify(response) } }],
      usage:{ prompt_tokens:10, completion_tokens:4, total_tokens:14 }
    }) } }
  };
  const usage = { prompt:0, completion:0, total:0 };
  const state = {
    type:'entity',
    name:'Facility',
    entityName:'Facility',
    evidence:{ entity:{ name:'Facility', description:'Physical facility' } },
    schemaFields:[
      { name:'facilityId', type:'id', isPk:true, description:'' },
      { name:'geoId', type:'id', isPk:false, description:'' }
    ]
  };
  const fkCandidates = [{
    name:'Geo',
    entityName:'Geo',
    edge:{ kind:'schema_fk', join:{ from:'Facility', to:'Geo', relationship:'geo', cardinality:'one', keyMaps:[{ fieldName:'geoId', relatedFieldName:'geoId' }] } }
  }];

  const result = await evaluateEntityCoverage({
    state,
    dimensions:['region'],
    missingDimensions:['region'],
    fkCandidates,
    intent:'sales by region',
    client,
    model:'fake',
    usage,
    log:(type, payload) => events.push({ type, payload }),
    step:7
  });

  assert.deepEqual(result.covered, []);
  assert.equal(result.follow.length, 1);
  assert.equal(result.follow[0].state.entityName, 'Geo');
  assert.deepEqual(result.follow[0].score, { region:0.8 });

  const raw = events.find((event) => event.type === 'query_v4_entity_raw_model');
  assert.ok(raw, 'raw model decision log must be emitted');
  assert.equal(raw.payload.entity, 'Facility');
  assert.deepEqual(raw.payload.parsed, response);
  assert.deepEqual(raw.payload.normalized, { e:[], f:[[0, [[0, 0.8]]]] });
});
