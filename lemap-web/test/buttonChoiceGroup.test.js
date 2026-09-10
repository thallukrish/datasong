import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverGroups } from '../src/preprocess/groupDiscovery.js';
import { buildStructuralEntitiesFromPreprocessed } from '../src/graph/structuralEntityBuilder.js';
import { entitiesNeedingSemantics } from '../src/semantic/entitySemanticResolver.js';
import { buildEntityQuestion, selectNextUserInput } from '../src/agent/entityFlow.js';
import { createInstanceGraph } from '../src/graph/instanceGraph.js';

function button(id, label, context) {
  return {
    id,
    entityId: 'entity:page',
    domId: id,
    name: '',
    label,
    type: 'button',
    rawType: 'button',
    role: '',
    tag: 'button',
    href: '',
    parentRegionLabel: context,
    parentRegionTag: 'div',
    regionPath: [context],
    parentGroupId: null,
    required: false,
    disabled: false,
    visible: true,
    readonly: false,
    checked: null,
    defaultChecked: null,
    placeholder: '',
    value: '',
    defaultValue: '',
    valueDomain: [],
    attributes: {}
  };
}

test('yes/no answer buttons become one question entity and members are not semantic questions', () => {
  const context = 'Do you have income from any business or profession?';
  const yes = button('yes-button', 'Yes', context);
  const no = button('no-button', 'No', context);
  const controls = [yes, no];
  const groups = discoverGroups(controls, 'entity:page');

  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupType, 'choice');
  assert.equal(groups[0].label, context);

  const built = buildStructuralEntitiesFromPreprocessed({
    entity: {
      id: 'entity:page',
      label: 'Know Your ITR Form',
      presentation: { pageId: 'page:1', url: 'https://example.test', route: '/', title: 'Test', rootTag: 'body', overlay: false }
    },
    fields: [],
    actions: controls,
    groups
  });

  const group = built.entities.find((entity) => entity.type === 'group');
  const yesEntity = built.entities.find((entity) => entity.name === 'Yes');
  const noEntity = built.entities.find((entity) => entity.name === 'No');
  assert.ok(group);
  assert.equal(group.structural.cardinality, 'exactlyOne');
  assert.deepEqual(group.structural.values, ['Yes', 'No']);

  const unresolved = entitiesNeedingSemantics(built.entities);
  assert.ok(unresolved.some((entity) => entity.id === group.id));
  assert.equal(unresolved.some((entity) => entity.id === yesEntity.id), false);
  assert.equal(unresolved.some((entity) => entity.id === noEntity.id), false);

  group.semantic = {
    interaction: 'user_input',
    relevantToGoal: true,
    required: true,
    question: context,
    selectionRule: 'exactlyOne'
  };
  const selected = selectNextUserInput(built.entities, createInstanceGraph());
  assert.equal(selected?.id, group.id);

  const question = buildEntityQuestion(group, built.entities);
  assert.equal(question.label, context);
  assert.deepEqual(question.options, ['Yes', 'No']);
});

test('multi-button questionnaire choices are grouped while navigation actions are not', () => {
  const context = 'What is your residential status?';
  const choices = [
    button('ror', 'Resident And Ordinarily Resident (ROR)', context),
    button('nor', 'Not Ordinarily Resident (NOR)', context),
    button('nr', 'Non Resident (NR)', context),
    button('unknown', 'Don’t Know', context)
  ];
  assert.equal(discoverGroups(choices, 'entity:page').length, 1);

  const actions = [button('continue', 'Continue', 'Please Note'), button('cancel', 'Cancel', 'Please Note')];
  assert.equal(discoverGroups(actions, 'entity:page').length, 0);
});
