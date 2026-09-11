import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPageHierarchy } from '../src/orchestrator/pageHierarchy.js';

function entity(id, type = 'container') {
  return { id, type, name: id, structural: {}, semantic: {}, links: [] };
}

test('buildPageHierarchy materializes contains and partOf links from neutral hierarchy edges', () => {
  const page = entity('page:1', 'page');
  const section = entity('entity:section');
  const radio = entity('entity:radio', 'ui_control');

  const result = buildPageHierarchy({
    page,
    entities: [page, section, radio],
    hierarchy: [
      { parentId: page.id, childId: section.id },
      { parentId: section.id, childId: radio.id }
    ]
  });

  assert.deepEqual(result.byId.get(page.id).links, [
    { id: section.id, relationship: 'contains' }
  ]);
  assert.deepEqual(result.byId.get(section.id).links, [
    { id: page.id, relationship: 'partOf' },
    { id: radio.id, relationship: 'contains' }
  ]);
  assert.deepEqual(result.byId.get(radio.id).links, [
    { id: section.id, relationship: 'partOf' }
  ]);
});

test('buildPageHierarchy preserves real nesting instead of flattening descendants under the page', () => {
  const page = entity('page:1', 'page');
  const section = entity('entity:section');
  const card = entity('entity:card');
  const control = entity('entity:control', 'ui_control');

  const result = buildPageHierarchy({
    page,
    entities: [page, section, card, control],
    hierarchy: [
      { parentId: page.id, childId: section.id },
      { parentId: section.id, childId: card.id },
      { parentId: card.id, childId: control.id }
    ]
  });

  assert.deepEqual(
    result.byId.get(page.id).links.filter((link) => link.relationship === 'contains').map((link) => link.id),
    [section.id]
  );
  assert.deepEqual(
    result.byId.get(card.id).links.filter((link) => link.relationship === 'contains').map((link) => link.id),
    [control.id]
  );
});

test('buildPageHierarchy does not duplicate structural links when the same edge appears twice', () => {
  const page = entity('page:1', 'page');
  const child = entity('entity:child');
  const edge = { parentId: page.id, childId: child.id };

  const result = buildPageHierarchy({
    page,
    entities: [page, child],
    hierarchy: [edge, edge]
  });

  assert.equal(result.byId.get(page.id).links.length, 1);
  assert.equal(result.byId.get(child.id).links.length, 1);
});

test('buildPageHierarchy rejects hierarchy edges that reference unknown entities', () => {
  const page = entity('page:1', 'page');

  assert.throws(() => buildPageHierarchy({
    page,
    entities: [page],
    hierarchy: [{ parentId: page.id, childId: 'entity:missing' }]
  }), /unknown entity/i);
});
