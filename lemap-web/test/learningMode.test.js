import test from 'node:test';
import assert from 'node:assert/strict';
import {
  learningCandidates,
  learningConfigFromEnv,
  newValidationMessages,
  proposalForEntity,
  selectProposedLearningInput
} from '../src/agent/learningMode.js';

const knownInput = {
  id: 'field:amount',
  name: 'Amount',
  type: 'ui_control',
  structural: { controlType: 'text', visible: true, disabled: false },
  semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'What amount?' },
  links: []
};

const unansweredGroup = {
  id: 'group:choice',
  name: 'Choice',
  type: 'group',
  structural: { cardinality: 'exactlyOne', values: ['Alpha', 'Beta'], visible: true, disabled: false },
  semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which choice?' },
  links: []
};

test('learning mode defaults to single-step while run mode does not generate learning values', () => {
  assert.deepEqual(learningConfigFromEnv({ LEMAP_MODE: 'learn' }), { mode: 'learn', enabled: true, step: true });
  assert.deepEqual(learningConfigFromEnv({ LEMAP_MODE: 'learn', LEMAP_LEARN_STEP: '0' }), { mode: 'learn', enabled: true, step: false });
  assert.deepEqual(learningConfigFromEnv({}), { mode: 'run', enabled: false, step: false });
});

test('learning candidates include semantically known unanswered inputs without adding navigation controls', () => {
  const button = { id: 'button:next', type: 'ui_control', structural: { controlType: 'button', visible: true }, semantic: {}, links: [] };
  const instances = [{ id: 'instance:done', type: 'instance', value: 'x', links: [{ id: knownInput.id, relationship: 'instanceOf' }] }];
  assert.deepEqual(learningCandidates([knownInput, unansweredGroup, button], instances).map((entity) => entity.id), [unansweredGroup.id]);
});

test('cached learning proposals are excluded from later semantic batches', () => {
  const cached = new Set([unansweredGroup.id]);
  assert.deepEqual(learningCandidates([knownInput, unansweredGroup], [], cached).map((entity) => entity.id), [knownInput.id]);
});

test('proposal-backed visible input is consumed before navigation even when semantic classification is incomplete', () => {
  const incompletelyClassified = {
    id: 'group:filing-mode',
    name: 'Online Offline',
    type: 'group',
    structural: { cardinality: 'exactlyOne', values: ['Online', 'Offline'], visible: true, disabled: false },
    semantic: { interaction: 'unknown', relevantToGoal: false, required: false },
    links: []
  };
  const navigation = {
    id: 'button:menu',
    name: 'Menu',
    type: 'ui_control',
    structural: { controlType: 'button', visible: true, disabled: false },
    semantic: {},
    links: []
  };
  const proposals = new Map([[incompletelyClassified.id, '1']]);

  const selected = selectProposedLearningInput([navigation, incompletelyClassified], [], proposals);
  assert.equal(selected?.id, incompletelyClassified.id);
});

test('proposal-backed learning input ignores hidden, disabled and already-instanced entities', () => {
  const hidden = { ...unansweredGroup, id: 'group:hidden', structural: { ...unansweredGroup.structural, visible: false } };
  const disabled = { ...unansweredGroup, id: 'group:disabled', structural: { ...unansweredGroup.structural, disabled: true } };
  const done = { ...unansweredGroup, id: 'group:done' };
  const proposals = new Map([[hidden.id, '1'], [disabled.id, '1'], [done.id, '1']]);
  const instances = [{ id: 'instance:done', type: 'instance', value: 'Alpha', links: [{ id: done.id, relationship: 'instanceOf' }] }];

  assert.equal(selectProposedLearningInput([hidden, disabled, done], instances, proposals), null);
});

test('learning proposal lookup is keyed by entity id and remains separate from semantic state', () => {
  const result = {
    entities: [{ id: unansweredGroup.id, semantic: { interaction: 'user_input' }, learningAnswer: '2' }]
  };
  assert.equal(proposalForEntity(result, unansweredGroup.id), '2');
  assert.equal(proposalForEntity(result, 'field:missing'), null);
});

test('new validation messages detect model-value rejection without treating pre-existing messages as failures', () => {
  const before = { explored: { snapshot: { validations: ['Existing warning'] } } };
  const after = { explored: { snapshot: { validations: ['Existing warning', 'Value is invalid'] } } };
  assert.deepEqual(newValidationMessages(before, after), ['Value is invalid']);
});
