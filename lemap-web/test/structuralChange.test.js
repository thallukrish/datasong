import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityGraph, findEntity } from '../src/graph/entityGraph.js';
import { applyObservedStructuralChange } from '../src/graph/structuralChange.js';

const page = { id: 'page:1', name: 'Setup', type: 'page', structural: { route: '/setup' }, semantic: {}, links: [] };
const trigger = { id: 'field:choice', name: 'Choice', type: 'ui_control', structural: { controlType: 'select', value: '', values: ['A', 'B'], visible: true, disabled: false }, semantic: { meaning: 'choice' }, links: [{ id: 'page:1', relationship: 'childOf' }] };
const buttonDisabled = { id: 'button:next', name: 'Next', type: 'ui_control', structural: { controlType: 'button', visible: true, disabled: true }, semantic: { workflowRole: 'continue' }, links: [{ id: 'page:1', relationship: 'childOf' }] };

test('newly appearing entity is added and linked causally to the triggering field', () => {
  const graph = createEntityGraph([page, trigger, buttonDisabled]);
  const before = createEntityGraph([page, trigger, buttonDisabled]);
  const after = createEntityGraph([
    page,
    { ...trigger, structural: { ...trigger.structural, value: 'A' } },
    buttonDisabled,
    { id: 'field:detail', name: 'Detail', type: 'ui_control', structural: { controlType: 'text', visible: true, disabled: false, value: '' }, semantic: {}, links: [{ id: 'page:1', relationship: 'childOf' }] }
  ]);

  const result = applyObservedStructuralChange(graph, { beforeEntities: before, afterEntities: after, triggerEntityId: 'field:choice', ignoredEntityIds: ['field:choice'] });
  const detail = findEntity(graph, 'field:detail');

  assert.deepEqual(result.addedEntityIds, ['field:detail']);
  assert.ok(detail.links.some((link) => link.id === 'field:choice' && link.relationship === 'appearsOnModificationOf'));
  assert.ok(findEntity(graph, 'field:choice').links.some((link) => link.id === 'field:detail' && link.relationship === 'causesAppearanceOf'));
});

test('changed existing entity becomes a version node while original state is preserved', () => {
  const graph = createEntityGraph([page, trigger, buttonDisabled]);
  const before = createEntityGraph([page, trigger, buttonDisabled]);
  const after = createEntityGraph([
    page,
    { ...trigger, structural: { ...trigger.structural, value: 'A' } },
    { ...buttonDisabled, structural: { ...buttonDisabled.structural, disabled: false } }
  ]);

  const result = applyObservedStructuralChange(graph, { beforeEntities: before, afterEntities: after, triggerEntityId: 'field:choice', ignoredEntityIds: ['field:choice'] });
  assert.equal(findEntity(graph, 'button:next').structural.disabled, true);
  assert.equal(result.versionEntityIds.length, 1);

  const version = findEntity(graph, result.versionEntityIds[0]);
  assert.equal(version.structural.disabled, false);
  assert.ok(version.links.some((link) => link.id === 'button:next' && link.relationship === 'copyOf'));
  assert.ok(version.links.some((link) => link.id === 'field:choice' && link.relationship === 'onModificationOf'));
  assert.ok(findEntity(graph, 'button:next').links.some((link) => link.id === version.id && link.relationship === 'hasCopy'));
});
