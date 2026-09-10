import test from 'node:test';
import assert from 'node:assert/strict';
import { selectNextUserInput, selectReusableUserInput } from '../src/agent/entityFlow.js';
import { createInstanceGraph } from '../src/graph/instanceGraph.js';

const page = {
  id: 'page:status',
  name: 'Please select the status applicable to you to proceed further',
  type: 'page',
  structural: {},
  semantic: { interaction: 'user_input', relevantToGoal: true, required: true },
  links: []
};

const group = {
  id: 'group:status',
  name: 'Status',
  type: 'group',
  structural: {
    groupType: 'radio',
    cardinality: 'exactlyOne',
    values: ['Individual', 'HUF', 'Others'],
    visible: true,
    disabled: false
  },
  semantic: {
    interaction: 'user_input',
    relevantToGoal: true,
    required: true,
    question: 'Which status applies to you?'
  },
  links: []
};

test('page semantics can never become a user input prompt', () => {
  assert.equal(selectNextUserInput([page, group], createInstanceGraph())?.id, 'group:status');
});

test('page semantics can never become a reusable stored input target', () => {
  const instances = createInstanceGraph([
    { id: 'instance:page', type: 'instance', value: 'bad', links: [{ id: 'page:status', relationship: 'instanceOf' }] },
    { id: 'instance:status', type: 'instance', value: 'Individual', links: [{ id: 'group:status', relationship: 'instanceOf' }] }
  ]);
  const reusable = selectReusableUserInput([page, group], instances);
  assert.equal(reusable?.entity.id, 'group:status');
});
