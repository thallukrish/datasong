import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEntityGraph,
  findEntity,
  upsertEntity,
  upsertEntities,
  linkEntities,
  mergeSemanticPatch
} from '../src/graph/entityGraph.js';

function entity(id, overrides = {}) {
  return {
    id,
    type: 'container',
    name: id,
    structural: {},
    semantic: {},
    links: [],
    ...overrides
  };
}

test('createEntityGraph produces a plain serializable graph and deduplicates ids', () => {
  const graph = createEntityGraph({
    entities: [
      entity('a', { name: 'first' }),
      entity('a', { name: 'second', structural: { tag: 'section' } }),
      entity('b')
    ]
  });

  assert.equal(graph.version, 1);
  assert.deepEqual(graph.entities.map((item) => item.id), ['a', 'b']);
  assert.equal(findEntity(graph, 'a').name, 'second');
  assert.equal(findEntity(graph, 'a').structural.tag, 'section');
  assert.doesNotThrow(() => JSON.stringify(graph));
});

test('upsertEntity merges structural and semantic facts without duplicating links', () => {
  const graph = createEntityGraph({
    entities: [entity('a', {
      structural: { tag: 'section' },
      semantic: { concept: 'income' },
      links: [{ id: 'b', relationship: 'contains' }]
    })]
  });

  upsertEntity(graph, entity('a', {
    name: 'Income section',
    structural: { role: 'region' },
    semantic: { confidence: 0.9 },
    links: [
      { id: 'b', relationship: 'contains' },
      { id: 'c', relationship: 'contains' }
    ]
  }));

  const updated = findEntity(graph, 'a');
  assert.equal(updated.name, 'Income section');
  assert.deepEqual(updated.structural, { tag: 'section', role: 'region' });
  assert.deepEqual(updated.semantic, { concept: 'income', confidence: 0.9 });
  assert.deepEqual(updated.links, [
    { id: 'b', relationship: 'contains' },
    { id: 'c', relationship: 'contains' }
  ]);
});

test('upsertEntities ingests page hierarchy and group entities without duplication', () => {
  const graph = createEntityGraph();
  upsertEntities(graph, [
    entity('page', { type: 'page' }),
    entity('section'),
    entity('group', { type: 'ui_group' })
  ]);
  upsertEntities(graph, [entity('section', { name: 'Updated section' })]);

  assert.equal(graph.entities.length, 3);
  assert.equal(findEntity(graph, 'section').name, 'Updated section');
});

test('linkEntities creates directed and optional reverse relationships idempotently', () => {
  const graph = createEntityGraph({ entities: [entity('a'), entity('b')] });

  linkEntities(graph, 'a', 'b', 'contains', { reverseRelationship: 'partOf' });
  linkEntities(graph, 'a', 'b', 'contains', { reverseRelationship: 'partOf' });

  assert.deepEqual(findEntity(graph, 'a').links, [{ id: 'b', relationship: 'contains' }]);
  assert.deepEqual(findEntity(graph, 'b').links, [{ id: 'a', relationship: 'partOf' }]);
});

test('linkEntities preserves edge metadata and rejects unknown entities', () => {
  const graph = createEntityGraph({ entities: [entity('a'), entity('b')] });

  linkEntities(graph, 'a', 'b', 'dynamicChild', {
    metadata: { condition: { value: 'N' } }
  });

  assert.deepEqual(findEntity(graph, 'a').links[0], {
    id: 'b',
    relationship: 'dynamicChild',
    condition: { value: 'N' }
  });
  assert.throws(() => linkEntities(graph, 'a', 'missing', 'contains'), /unknown entity/i);
});

test('mergeSemanticPatch changes semantic enrichment only', () => {
  const graph = createEntityGraph({
    entities: [entity('a', {
      structural: { tag: 'section' },
      semantic: { concept: 'income' }
    })]
  });

  mergeSemanticPatch(graph, 'a', { description: 'Taxpayer income details', concept: 'earnings' });

  const updated = findEntity(graph, 'a');
  assert.deepEqual(updated.structural, { tag: 'section' });
  assert.deepEqual(updated.semantic, {
    concept: 'earnings',
    description: 'Taxpayer income details'
  });
  assert.throws(() => mergeSemanticPatch(graph, 'missing', { x: 1 }), /unknown entity/i);
});
