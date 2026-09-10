import test from 'node:test';
import assert from 'node:assert/strict';
import {
  learningCandidates,
  learningConfigFromEnv,
  newValidationMessages,
  proposalForEntity
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

test('persisted learning instances are not regenerated because replay owns them in every mode', () => {
  const instances = [{
    id: 'instance:choice',
    type: 'instance',
    value: 'Alpha',
    mode: 'learning',
    source: 'model',
    links: [{ id: unansweredGroup.id, relationship: 'instanceOf' }]
  }];
  assert.deepEqual(learningCandidates([unansweredGroup], instances), []);
});

test('cached learning proposals are excluded from later semantic batches', () => {
  const cached = new Set([unansweredGroup.id]);
  assert.deepEqual(learningCandidates([knownInput, unansweredGroup], [], cached).map((entity) => entity.id), [knownInput.id]);
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
  const after = { explored: { snapshot: { validations: ['Existing warning', 'Value is invalid'] } };
  assert.deepEqual(newValidationMessages(before, after), ['Value is invalid']);
});
