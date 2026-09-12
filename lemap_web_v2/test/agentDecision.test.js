import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstanceGraph, upsertInstance } from '../src/graph/instanceGraph.js';
import {
  selectNextRequiredInput,
  buildInputQuestion,
  selectReusableInput,
  selectNavigationCandidates,
  workflowComplete
} from '../src/agent/agentDecision.js';

function control(id, {
  name = id,
  controlType = 'text',
  semantic = {},
  visible = true,
  disabled = false,
  values = []
} = {}) {
  return {
    id,
    type: 'ui_control',
    name,
    structural: { controlType, visible, disabled, values },
    semantic,
    links: []
  };
}

function group(id, {
  name = id,
  semantic = {},
  values = [],
  cardinality = 'exactlyOne'
} = {}) {
  return {
    id,
    type: 'ui_group',
    name,
    structural: { values, cardinality },
    semantic,
    links: []
  };
}

const requiredInput = {
  interaction: 'user_input',
  relevantToGoal: true,
  required: true,
  question: 'What is your income?'
};

test('selectNextRequiredInput returns the first visible required input without an instance', () => {
  const instanceGraph = createInstanceGraph();
  upsertInstance(instanceGraph, { entityId: 'field:a', value: 'already set' });
  const entities = [
    control('field:a', { semantic: requiredInput }),
    control('field:b', { semantic: requiredInput }),
    control('field:c', { semantic: { ...requiredInput, required: false } })
  ];

  assert.equal(selectNextRequiredInput({ entities, instanceGraph })?.id, 'field:b');
});

test('selectNextRequiredInput ignores invisible, disabled and grouped member controls', () => {
  const instanceGraph = createInstanceGraph();
  const member = control('radio:a', { controlType: 'radio', semantic: requiredInput });
  member.links.push({ id: 'group:status', relationship: 'memberOf' });
  const entities = [
    control('hidden', { semantic: requiredInput, visible: false }),
    control('disabled', { semantic: requiredInput, disabled: true }),
    member,
    group('group:status', { semantic: requiredInput, values: ['Yes', 'No'] })
  ];

  assert.equal(selectNextRequiredInput({ entities, instanceGraph })?.id, 'group:status');
});

test('buildInputQuestion uses learned semantic question, explanation, examples and finite choices', () => {
  const entity = group('group:status', {
    name: 'Filing status',
    values: ['Yes', 'No'],
    semantic: {
      ...requiredInput,
      question: 'Are you filing jointly?',
      explanation: 'This affects eligibility.',
      examples: ['Yes if filing with spouse'],
      selectionRule: 'exactlyOne'
    }
  });

  assert.deepEqual(buildInputQuestion(entity), {
    entityId: 'group:status',
    label: 'Are you filing jointly?',
    information: 'This affects eligibility.',
    examples: ['Yes if filing with spouse'],
    options: ['Yes', 'No'],
    finite: true,
    selectionRule: 'exactlyOne'
  });
});

test('selectReusableInput returns a visible required input whose stored instance can be reused', () => {
  const instanceGraph = createInstanceGraph();
  upsertInstance(instanceGraph, { entityId: 'field:a', value: '50000' });
  const entities = [control('field:a', { semantic: requiredInput })];

  const reusable = selectReusableInput({ entities, instanceGraph, appliedEntityIds: [] });
  assert.equal(reusable.entity.id, 'field:a');
  assert.equal(reusable.instance.value, '50000');

  assert.equal(selectReusableInput({ entities, instanceGraph, appliedEntityIds: ['field:a'] }), null);
});

test('selectNavigationCandidates keeps unresolved buttons for later navigation choice but filters known irrelevant controls', () => {
  const entities = [
    control('next', { controlType: 'button', semantic: { interaction: 'navigation', relevantToGoal: true } }),
    control('unknown', { controlType: 'button' }),
    control('cancel', { controlType: 'button', semantic: { interaction: 'navigation', relevantToGoal: false } }),
    control('input-button', { controlType: 'button', semantic: { interaction: 'user_input', relevantToGoal: true } }),
    control('hidden-next', { controlType: 'link', semantic: { interaction: 'navigation', relevantToGoal: true }, visible: false }),
    control('field', { semantic: requiredInput })
  ];

  assert.deepEqual(selectNavigationCandidates(entities).map((entity) => entity.id), ['next', 'unknown']);
});

test('selectNavigationCandidates excludes actions already applied in the active frame', () => {
  const next = control('next', { controlType: 'button', semantic: { interaction: 'navigation', relevantToGoal: true } });
  assert.deepEqual(selectNavigationCandidates([next], { appliedEntityIds: ['next'] }), []);
});

test('workflowComplete is false while required input or relevant navigation remains and true otherwise', () => {
  const emptyInstances = createInstanceGraph();
  const filledInstances = createInstanceGraph();
  upsertInstance(filledInstances, { entityId: 'field:a', value: 'x' });

  const input = control('field:a', { semantic: requiredInput });
  const next = control('next', { controlType: 'button', semantic: { interaction: 'navigation', relevantToGoal: true } });

  assert.equal(workflowComplete({ entities: [input], instanceGraph: emptyInstances }), false);
  assert.equal(workflowComplete({ entities: [input], instanceGraph: filledInstances }), true);
  assert.equal(workflowComplete({ entities: [next], instanceGraph: emptyInstances }), false);
  assert.equal(workflowComplete({ entities: [], instanceGraph: emptyInstances }), true);
});
