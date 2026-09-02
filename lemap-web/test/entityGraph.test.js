import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocessEntity } from '../src/graph/entityPreprocessor.js';
import { projectEntityState } from '../src/graph/entityState.js';

const snapshot = {
  page: 'Generic Filing Form',
  url: 'https://example.test/app/#/filing/reasons',
  title: 'Synthetic App',
  dom: { tag: 'body', label: 'Generic Filing Form', hidden: false, children: [
    { control: true, tag: 'button', type: 'button', label: 'Menu', hidden: false },
    { tag: 'div', label: 'Generic Filing Form', hidden: false, children: [
      { tag: 'fieldset', label: 'Filing reason', hidden: false, children: [
        { control: true, tag: 'input', type: 'radio', name: 'reason', value: 'A', checked: true, label: 'Reason A', hidden: false },
        { control: true, tag: 'input', type: 'radio', name: 'reason', value: 'B', checked: false, label: 'Reason B', hidden: false },
        { control: true, tag: 'input', type: 'checkbox', name: 'condition1', value: 'on', checked: false, label: 'Condition 1', disabled: true, hidden: false },
        { control: true, tag: 'input', type: 'checkbox', name: 'condition2', value: 'on', checked: false, label: 'Condition 2', disabled: true, hidden: false }
      ]},
      { control: true, tag: 'button', type: 'button', label: 'Continue', hidden: false }
    ]}
  ]},
  values: { 'Reason A': 'A', 'Reason B': null, 'Condition 1': false, 'Condition 2': false },
  regions: { 'Generic Filing Form': { visible: true }, 'Filing reason': { visible: true } },
  validations: [],
  options: {}
};

test('page data is presentation evidence on a structural entity, not a semantic page object', () => {
  const graph = preprocessEntity(snapshot);
  assert.match(graph.entity.id, /^entity:/);
  assert.match(graph.entity.presentation.pageId, /^page:/);
  assert.equal(graph.entity.presentation.route, '/app/#/filing/reasons');
  assert.equal(graph.page, undefined);
  assert.equal(graph.activeWorkflow, undefined);
});

test('entity preprocessing exposes fields, actions, groups and candidate methods', () => {
  const graph = preprocessEntity(snapshot);
  assert.ok(graph.fields.some((field) => field.label === 'Reason B' && field.type === 'radio'));
  assert.ok(graph.actions.some((action) => action.label === 'Continue'));
  assert.equal(graph.actions.some((action) => action.label === 'Menu'), false);
  assert.ok(graph.groups.some((group) => group.groupType === 'radio' && group.memberFieldIds.length === 2));
  const reasonB = graph.fields.find((field) => field.label === 'Reason B');
  assert.ok(graph.methods.some((method) => method.fieldId === reasonB.id && method.actions.some((action) => action.kind === 'select')));
});

test('dominant business form wins over a deeper embedded support widget', () => {
  const withWidget = structuredClone(snapshot);
  withWidget.dom.children.push({
    tag: 'aside',
    label: 'Welcome to Support',
    hidden: false,
    children: [
      { tag: 'div', label: 'Support session', hidden: false, children: [
        { control: true, tag: 'input', type: 'text', name: 'support-code', label: 'Session code', value: '', hidden: false },
        { control: true, tag: 'button', type: 'button', label: 'Start support', hidden: false }
      ]}
    ]
  });
  const graph = preprocessEntity(withWidget);
  assert.equal(graph.entity.label, 'Generic Filing Form');
  assert.ok(graph.fields.some((field) => field.label === 'Reason A'));
  assert.equal(graph.fields.some((field) => field.label === 'Session code'), false);
});

test('candidate action identity is deterministic across repeated preprocessing', () => {
  const first = preprocessEntity(snapshot);
  const second = preprocessEntity(structuredClone(snapshot));
  const firstIds = first.methods.flatMap((method) => method.actions.map((action) => action.id));
  const secondIds = second.methods.flatMap((method) => method.actions.map((action) => action.id));
  assert.deepEqual(firstIds, secondIds);
  assert.ok(firstIds.every((id) => /^action:[a-f0-9]{12}$/.test(id)));
});

test('entity state projection uses checked state for radios/checkboxes', () => {
  const graph = preprocessEntity(snapshot);
  const state = projectEntityState(snapshot, graph);
  const reasonA = graph.fields.find((field) => field.label === 'Reason A');
  const reasonB = graph.fields.find((field) => field.label === 'Reason B');
  assert.equal(state.fields[reasonA.id].value, 'A');
  assert.equal(state.fields[reasonB.id].value, null);
  assert.equal(state.entityId, graph.entity.id);
  assert.equal(state.presentation.pageId, graph.entity.presentation.pageId);
});

test('entity identity stays stable when a completion action inside the visible entity becomes hidden', () => {
  const before = preprocessEntity(snapshot);
  const afterSnapshot = structuredClone(snapshot);
  const entityRoot = afterSnapshot.dom.children[1];
  entityRoot.children[1].hidden = true;
  const after = preprocessEntity(afterSnapshot);
  assert.equal(before.entity.id, after.entity.id);
  assert.equal(after.entity.label, 'Generic Filing Form');
  assert.ok(after.actions.some((action) => action.label === 'Continue' && action.visible === false));
});