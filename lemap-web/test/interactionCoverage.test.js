import test from 'node:test';
import assert from 'node:assert/strict';
import { coveredInteractionFieldIds, uncoveredUserInputFields } from '../src/agent/interactionCoverage.js';

const graph = {
  fields: [
    { id: 'field:year', type: 'select' },
    { id: 'field:online', type: 'radio', parentGroupId: 'group:mode' },
    { id: 'field:offline', type: 'radio', parentGroupId: 'group:mode' }
  ],
  groups: [{ id: 'group:mode', groupType: 'radio', memberFieldIds: ['field:online', 'field:offline'] }]
};

const state = { fields: {
  'field:year': { visible: true, enabled: true },
  'field:online': { visible: true, enabled: true },
  'field:offline': { visible: true, enabled: true }
} };

test('one learned radio member covers the entire structural radio group', () => {
  const semanticEntity = { interactions: [
    { semanticKey: 'assessment-year', structuralFieldIds: ['field:year'] },
    { semanticKey: 'itr-mode', structuralFieldIds: ['field:online'] }
  ] };
  const covered = coveredInteractionFieldIds(graph, semanticEntity);
  assert.ok(covered.has('field:online'));
  assert.ok(covered.has('field:offline'));
  assert.deepEqual(uncoveredUserInputFields(graph, state, semanticEntity), []);
});

test('truly new enabled field remains uncovered', () => {
  const expandedGraph = structuredClone(graph);
  expandedGraph.fields.push({ id: 'field:new', type: 'text' });
  const expandedState = structuredClone(state);
  expandedState.fields['field:new'] = { visible: true, enabled: true };
  const semanticEntity = { interactions: [{ semanticKey: 'itr-mode', structuralFieldIds: ['field:online'] }] };
  const uncovered = uncoveredUserInputFields(expandedGraph, expandedState, semanticEntity);
  assert.deepEqual(uncovered.map((field) => field.id).sort(), ['field:new', 'field:year']);
});
