import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowGraph, recordTransition, classifyTransition, isEmptyEntityDelta } from '../src/graph/workflowGraph.js';

const delta = (overrides = {}) => ({
  fieldValuesChanged: [], fieldsEnabled: [], fieldsDisabled: [], fieldsShown: [], fieldsHidden: [], fieldsAdded: [], fieldsRemoved: [],
  actionsEnabled: [], actionsDisabled: [], actionsShown: [], actionsHidden: [], regionsShown: [], regionsHidden: [],
  validationMessagesAdded: [], validationMessagesRemoved: [], optionsAdded: {}, optionsRemoved: {},
  routeChanged: false, entityChanged: false, ...overrides
});

test('transition classification distinguishes local expansion, overlay and navigation', () => {
  assert.equal(classifyTransition(delta()), 'state_change');
  assert.equal(classifyTransition(delta({ fieldsAdded: ['f2'] })), 'inline_expand');
  assert.equal(classifyTransition(delta(), { overlayOpened: true }), 'overlay_open');
  assert.equal(classifyTransition(delta({ routeChanged: true, entityChanged: true })), 'navigation');
});

test('empty entity deltas do not create workflow edges', () => {
  const graph = createWorkflowGraph('workflow:x');
  assert.equal(isEmptyEntityDelta(delta()), true);
  const edge = recordTransition(graph, {
    sourceEntityId: 'entity:a', targetEntityId: 'entity:a', sourceStateId: 'state:a0', targetStateId: 'state:a0',
    actionId: '', evidenceIds: ['obs:no-op'], delta: delta()
  });
  assert.equal(edge, null);
  assert.equal(graph.edges.length, 0);
  assert.deepEqual([...graph.nodes], ['entity:a']);
});

test('workflow graph records branchable entity/action transitions with provenance', () => {
  const graph = createWorkflowGraph('workflow:itr3');
  recordTransition(graph, {
    sourceEntityId: 'entity:filing', targetEntityId: 'entity:filing', actionId: 'action:reason-y',
    kind: 'inline_expand', branchCondition: 'reason=Y', evidenceIds: ['obs:1'], delta: delta({ fieldsAdded: ['conditions'] })
  });
  recordTransition(graph, {
    sourceEntityId: 'entity:filing', targetEntityId: 'entity:personal', actionId: 'action:continue',
    kind: 'navigation', branchCondition: 'valid', evidenceIds: ['obs:2'], delta: delta({ routeChanged: true, entityChanged: true })
  });
  assert.deepEqual([...graph.nodes].sort(), ['entity:filing', 'entity:personal']);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.edges[0].branchCondition, 'reason=Y');
  assert.deepEqual(graph.edges[1].evidenceIds, ['obs:2']);
});

test('revisiting the same entity can attach a different observed state without inventing a new entity', () => {
  const graph = createWorkflowGraph('workflow:x');
  recordTransition(graph, { sourceEntityId: 'entity:a', targetEntityId: 'entity:b', actionId: 'a1', kind: 'navigation', sourceStateId: 'state:a0', targetStateId: 'state:b0', evidenceIds: [], delta: delta({ entityChanged: true, routeChanged: true }) });
  recordTransition(graph, { sourceEntityId: 'entity:b', targetEntityId: 'entity:a', actionId: 'back', kind: 'navigation', sourceStateId: 'state:b1', targetStateId: 'state:a1', evidenceIds: [], delta: delta({ entityChanged: true, routeChanged: true }) });
  assert.equal([...graph.nodes].filter((id) => id === 'entity:a').length, 1);
  assert.deepEqual([...graph.entityStates['entity:a']].sort(), ['state:a0', 'state:a1']);
});