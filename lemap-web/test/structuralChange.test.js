import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityGraph, findEntity } from '../src/graph/entityGraph.js';
import { applyObservedStructuralChange } from '../src/graph/structuralChange.js';

const page = { id: 'page:1', name: 'Setup', type: 'page', structural: { route: '/setup' }, semantic: {}, links: [] };
const trigger = { id: 'field:choice', name: 'Choice', type: 'ui_control', structural: { controlType: 'select', defaultValue: '', value: '', values: ['A', 'B'], visible: true, disabled: false }, semantic: { meaning: 'choice' }, links: [{ id: 'page:1', relationship: 'childOf' }] };
const buttonDisabled = { id: 'button:next', name: 'Next', type: 'ui_control', structural: { controlType: 'button', defaultValue: null, value: null, visible: true, disabled: true }, semantic: { workflowRole: 'continue' }, links: [{ id: 'page:1', relationship: 'childOf' }] };

test('newly appearing entity is added and linked causally to the triggering field', () => {
  const graph = createEntityGraph([page, trigger, buttonDisabled]);
  const before = createEntityGraph([page, trigger, buttonDisabled]);
  const after = createEntityGraph([
    page,
    { ...trigger, structural: { ...trigger.structural, defaultValue: 'A', value: 'A' } },
    buttonDisabled,
    { id: 'field:detail', name: 'Detail', type: 'ui_control', structural: { controlType: 'text', defaultValue: '', value: '', visible: true, disabled: false }, semantic: {}, links: [{ id: 'page:1', relationship: 'childOf' }] }
  ]);

  const result = applyObservedStructuralChange(graph, { beforeEntities: before, afterEntities: after, triggerEntityId: 'field:choice', ignoredEntityIds: ['field:choice'] });
  const detail = findEntity(graph, 'field:detail');

  assert.deepEqual(result.addedEntityIds, ['field:detail']);
  assert.ok(detail.links.some((link) => link.id === 'field:choice' && link.relationship === 'appearsOnModificationOf'));
  assert.ok(findEntity(graph, 'field:choice').links.some((link) => link.id === 'field:detail' && link.relationship === 'causesAppearanceOf'));
});

test('changed existing entity becomes a version node while original state and defaults are preserved', () => {
  const graph = createEntityGraph([page, trigger, buttonDisabled]);
  const before = createEntityGraph([page, trigger, buttonDisabled]);
  const after = createEntityGraph([
    page,
    { ...trigger, structural: { ...trigger.structural, defaultValue: 'A', value: 'A' } },
    { ...buttonDisabled, structural: { ...buttonDisabled.structural, defaultValue: 'framework-current-value', disabled: false } }
  ]);

  const result = applyObservedStructuralChange(graph, { beforeEntities: before, afterEntities: after, triggerEntityId: 'field:choice', ignoredEntityIds: ['field:choice'] });
  assert.equal(findEntity(graph, 'button:next').structural.disabled, true);
  assert.equal(result.versionEntityIds.length, 1);

  const version = findEntity(graph, result.versionEntityIds[0]);
  assert.equal(version.structural.disabled, false);
  assert.equal(version.structural.defaultValue, null);
  assert.ok(version.links.some((link) => link.id === 'button:next' && link.relationship === 'copyOf'));
  assert.ok(version.links.some((link) => link.id === 'field:choice' && link.relationship === 'onModificationOf'));
  assert.ok(findEntity(graph, 'button:next').links.some((link) => link.id === version.id && link.relationship === 'hasCopy'));
});

test('a control that disappears is preserved as a hidden state version', () => {
  const detail = { id: 'field:detail', name: 'Detail', type: 'ui_control', structural: { controlType: 'text', defaultValue: '', value: '', visible: true, disabled: false }, semantic: { meaning: 'detail' }, links: [{ id: 'page:1', relationship: 'childOf' }] };
  const graph = createEntityGraph([page, trigger, detail]);
  const before = createEntityGraph([page, trigger, detail]);
  const after = createEntityGraph([
    page,
    { ...trigger, structural: { ...trigger.structural, defaultValue: 'B', value: 'B' } }
  ]);

  const result = applyObservedStructuralChange(graph, { beforeEntities: before, afterEntities: after, triggerEntityId: 'field:choice', ignoredEntityIds: ['field:choice'] });
  assert.equal(result.versionEntityIds.length, 1);
  const hidden = findEntity(graph, result.versionEntityIds[0]);
  assert.equal(hidden.structural.visible, false);
  assert.equal(hidden.structural.present, false);
  assert.equal(hidden.structural.defaultValue, '');
  assert.ok(hidden.links.some((link) => link.id === 'field:detail' && link.relationship === 'copyOf'));
  assert.ok(hidden.links.some((link) => link.id === 'field:choice' && link.relationship === 'onModificationOf'));
});
