import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEntityGraph,
  findEntity,
  linkEntities,
  mergeSemanticPatch,
  upsertEntity
} from '../src/graph/entityGraph.js';
import {
  createInstanceGraph,
  upsertInstanceValue
} from '../src/graph/instanceGraph.js';

test('entity graph stores nodes in one array and creates bidirectional links', () => {
  const graph = createEntityGraph();
  upsertEntity(graph, { id: 'page:1', name: 'Setup', type: 'page', structural: {}, semantic: {}, links: [] });
  upsertEntity(graph, { id: 'field:year', name: 'Year', type: 'ui_control', structural: { controlType: 'select', values: ['2026-27'] }, semantic: {}, links: [] });

  linkEntities(graph, 'page:1', 'field:year', 'contains', 'childOf');

  assert.deepEqual(findEntity(graph, 'page:1').links, [{ id: 'field:year', relationship: 'contains' }]);
  assert.deepEqual(findEntity(graph, 'field:year').links, [{ id: 'page:1', relationship: 'childOf' }]);
});

test('semantic patch enriches an entity without replacing structural facts', () => {
  const graph = createEntityGraph([
    { id: 'field:city', name: 'City', type: 'ui_control', structural: { controlType: 'text', defaultValue: '' }, semantic: {}, links: [] }
  ]);

  mergeSemanticPatch(graph, 'field:city', {
    meaning: 'city',
    scope: 'local',
    interaction: 'user_input',
    question: 'Which city?'
  });

  const entity = findEntity(graph, 'field:city');
  assert.equal(entity.structural.controlType, 'text');
  assert.equal(entity.semantic.meaning, 'city');
  assert.equal(entity.semantic.scope, 'local');
});

test('instance graph stores the user value separately and references the entity with instanceOf', () => {
  const instances = createInstanceGraph();
  const node = upsertInstanceValue(instances, 'field:year', '2026-27');

  assert.equal(node.type, 'instance');
  assert.equal(node.value, '2026-27');
  assert.deepEqual(node.links, [{ id: 'field:year', relationship: 'instanceOf' }]);
  assert.equal(instances.length, 1);

  upsertInstanceValue(instances, 'field:year', '2025-26');
  assert.equal(instances.length, 1);
  assert.equal(instances[0].value, '2025-26');
});
