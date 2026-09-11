import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityGraph, findEntity } from '../src/graph/entityGraph.js';
import { createPageEntity } from '../src/entity/canonicalEntity.js';
import { mergePageVisit } from '../src/orchestrator/pageReuse.js';

function container(id, name = id) {
  return {
    id,
    type: 'container',
    name,
    structural: { tag: 'div' },
    semantic: {},
    links: []
  };
}

test('first visit adds the page and current discovered entities', () => {
  const graph = createEntityGraph();
  const page = createPageEntity({ url: 'https://example.test/filing', title: 'Filing' });

  const result = mergePageVisit({ graph, page, entities: [container('section:status')] });

  assert.equal(result.reusedPage, false);
  assert.equal(result.pageEntityId, page.id);
  assert.deepEqual(new Set(result.addedEntityIds), new Set([page.id, 'section:status']));
  assert.equal(graph.entities.length, 2);
});

test('revisiting a known page reuses the same page entity and only adds new discoveries', () => {
  const graph = createEntityGraph();
  const page = createPageEntity({ url: 'https://example.test/filing', title: 'Filing' });

  mergePageVisit({ graph, page, entities: [container('section:status')] });
  const result = mergePageVisit({
    graph,
    page,
    entities: [container('section:status'), container('section:reason')]
  });

  assert.equal(result.reusedPage, true);
  assert.deepEqual(result.addedEntityIds, ['section:reason']);
  assert.equal(graph.entities.filter((entity) => entity.id === page.id).length, 1);
  assert.equal(graph.entities.filter((entity) => entity.id === 'section:status').length, 1);
  assert.ok(findEntity(graph, 'section:reason'));
});

test('query string changes do not create a duplicate page identity', () => {
  const graph = createEntityGraph();
  const first = createPageEntity({ url: 'https://example.test/filing?step=1', title: 'Filing' });
  const second = createPageEntity({ url: 'https://example.test/filing?step=2', title: 'Filing' });

  mergePageVisit({ graph, page: first });
  const result = mergePageVisit({ graph, page: second });

  assert.equal(first.id, second.id);
  assert.equal(result.reusedPage, true);
  assert.equal(graph.entities.filter((entity) => entity.type === 'page').length, 1);
});

test('a different route creates a different page entity', () => {
  const graph = createEntityGraph();
  const first = createPageEntity({ url: 'https://example.test/filing', title: 'Filing' });
  const second = createPageEntity({ url: 'https://example.test/summary', title: 'Summary' });

  mergePageVisit({ graph, page: first });
  const result = mergePageVisit({ graph, page: second });

  assert.equal(result.reusedPage, false);
  assert.notEqual(first.id, second.id);
  assert.equal(graph.entities.filter((entity) => entity.type === 'page').length, 2);
});

test('revisit merges new structural and semantic knowledge onto existing entities', () => {
  const graph = createEntityGraph();
  const page = createPageEntity({ url: 'https://example.test/filing', title: 'Filing' });
  const first = container('section:status', 'Status');

  mergePageVisit({ graph, page, entities: [first] });
  mergePageVisit({
    graph,
    page,
    entities: [{
      ...first,
      structural: { tag: 'div', role: 'region' },
      semantic: { purpose: 'collect filing status' }
    }]
  });

  const merged = findEntity(graph, 'section:status');
  assert.equal(merged.structural.role, 'region');
  assert.equal(merged.semantic.purpose, 'collect filing status');
  assert.equal(graph.entities.filter((entity) => entity.id === 'section:status').length, 1);
});
