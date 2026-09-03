import test from 'node:test';
import assert from 'node:assert/strict';
import { coveredInteractionFieldIds, uncoveredUserInputFields } from '../src/agent/interactionCoverage.js';
import { setControlScopeMemory } from '../src/agent/controlScope.js';

const graph = {
  entity: { id: 'entity:return' },
  fields: [
    { id: 'field:year', label: 'Assessment Year', type: 'select' },
    { id: 'field:online', label: 'Online', type: 'radio', parentGroupId: 'group:mode' },
    { id: 'field:offline', label: 'Offline', type: 'radio', parentGroupId: 'group:mode' }
  ],
  groups: [{ id: 'group:mode', groupType: 'radio', memberFieldIds: ['field:online', 'field:offline'] }]
};

const state = { fields: {
  'field:year': { visible: true, enabled: true },
  'field:online': { visible: true, enabled: true },
  'field:offline': { visible: true, enabled: true }
} };

test('one learned radio member covers the entire structural radio group', () => {
  setControlScopeMemory(null);
  const semanticEntity = { interactions: [
    { semanticKey: 'assessment-year', structuralFieldIds: ['field:year'] },
    { semanticKey: 'itr-mode', structuralFieldIds: ['field:online'] }
  ] };
  const covered = coveredInteractionFieldIds(graph, semanticEntity);
  assert.ok(covered.has('field:online'));
  assert.ok(covered.has('field:offline'));
  assert.deepEqual(uncoveredUserInputFields(graph, state, semanticEntity), []);
});

test('truly new enabled local field remains uncovered', () => {
  setControlScopeMemory(null);
  const expandedGraph = structuredClone(graph);
  expandedGraph.fields.push({ id: 'field:new', label: 'New Detail', type: 'text' });
  const expandedState = structuredClone(state);
  expandedState.fields['field:new'] = { visible: true, enabled: true };
  const semanticEntity = { interactions: [{ semanticKey: 'itr-mode', structuralFieldIds: ['field:online'] }] };
  const uncovered = uncoveredUserInputFields(expandedGraph, expandedState, semanticEntity);
  assert.deepEqual(uncovered.map((field) => field.id).sort(), ['field:new', 'field:year']);
});

test('recurring application control does not create a workflow coverage gap', () => {
  const language = { id: 'field:language-current', label: 'English selected under language', type: 'select' };
  const statusGraph = {
    entity: { id: 'entity:status' },
    fields: [
      language,
      { id: 'field:individual', label: 'Individual', type: 'radio', parentGroupId: 'group:status' },
      { id: 'field:huf', label: 'HUF', type: 'radio', parentGroupId: 'group:status' },
      { id: 'field:others', label: 'Others', type: 'radio', parentGroupId: 'group:status' }
    ],
    groups: [{ id: 'group:status', groupType: 'radio', memberFieldIds: ['field:individual', 'field:huf', 'field:others'] }]
  };
  const statusState = { fields: Object.fromEntries(statusGraph.fields.map((field) => [field.id, { visible: true, enabled: true }])) };
  const priorLanguage = { label: language.label, type: language.type, groupId: '' };
  setControlScopeMemory({ entities: {
    'entity:return': { structure: { fields: [priorLanguage] } },
    'entity:dashboard': { structure: { fields: [priorLanguage] } },
    'entity:status': { structure: { fields: [priorLanguage] } }
  } });

  const semanticEntity = { interactions: [{ semanticKey: 'assessee-status', structuralFieldIds: ['field:individual'] }] };
  assert.deepEqual(uncoveredUserInputFields(statusGraph, statusState, semanticEntity), []);
});
