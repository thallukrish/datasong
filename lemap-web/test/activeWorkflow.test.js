import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocessPage } from '../src/preprocess/pagePreprocessor.js';
import { projectPageState } from '../src/preprocess/stateProjection.js';
import { computeStateDelta } from '../src/preprocess/stateDelta.js';

function snapshot({ selected = 'A', conditionsEnabled = false, continueVisible = true } = {}) {
  return {
    page: 'Questionnaire',
    url: 'https://example.test/#/questionnaire',
    title: 'Example',
    dom: {
      tag: 'body', label: 'Questionnaire', hidden: false, children: [
        { control: true, tag: 'button', type: 'button', label: 'Open menu', name: 'menu', hidden: false },
        { tag: 'div', label: 'Hidden shell modal', hidden: true, children: [
          { control: true, tag: 'button', type: 'button', label: 'Confirm', name: 'confirm', hidden: true }
        ]},
        { tag: 'div', label: 'Questionnaire', hidden: false, children: [
          { tag: 'fieldset', label: 'Choose reason', hidden: false, children: [
            { control: true, tag: 'input', type: 'radio', name: 'reason', value: 'A', checked: selected === 'A', label: 'Reason A', hidden: false },
            { control: true, tag: 'input', type: 'radio', name: 'reason', value: 'B', checked: selected === 'B', label: 'Reason B', hidden: false },
            { control: true, tag: 'input', type: 'checkbox', name: 'condition1', value: 'on', checked: false, disabled: !conditionsEnabled, label: 'Condition 1', hidden: false }
          ]},
          { control: true, tag: 'button', type: 'button', label: 'Continue', name: 'continue', hidden: !continueVisible }
        ]}
      ]
    },
    values: {}, regions: {}, validations: [], options: {}
  };
}

test('preprocessPage scopes inputs to the active workflow region and excludes shell controls', () => {
  const model = preprocessPage(snapshot());
  assert.equal(model.activeWorkflow.label, 'Questionnaire');
  assert.equal(model.inputs.some((input) => input.label === 'Open menu'), false);
  assert.equal(model.inputs.some((input) => input.label === 'Confirm'), false);
  assert.equal(model.inputs.some((input) => input.label === 'Reason A'), true);
  assert.equal(model.inputs.some((input) => input.label === 'Continue'), true);
});

test('radio checked state and dependent state changes produce deterministic deltas without browser events', () => {
  const beforeSnapshot = snapshot({ selected: 'A', conditionsEnabled: false, continueVisible: true });
  const afterSnapshot = snapshot({ selected: 'B', conditionsEnabled: true, continueVisible: false });
  const beforeModel = preprocessPage(beforeSnapshot);
  const afterModel = preprocessPage(afterSnapshot);
  const beforeState = projectPageState(beforeSnapshot, beforeModel);
  const afterState = projectPageState(afterSnapshot, afterModel);
  const delta = computeStateDelta(beforeState, afterState);

  const reasonA = beforeModel.inputs.find((input) => input.label === 'Reason A');
  const reasonB = beforeModel.inputs.find((input) => input.label === 'Reason B');
  const condition1 = beforeModel.inputs.find((input) => input.label === 'Condition 1');
  const continueButton = beforeModel.inputs.find((input) => input.label === 'Continue');

  assert.equal(beforeState.inputs[reasonA.id].value, 'A');
  assert.equal(afterState.inputs[reasonA.id].value, null);
  assert.equal(beforeState.inputs[reasonB.id].value, null);
  assert.equal(afterState.inputs[reasonB.id].value, 'B');
  assert.ok(delta.inputsEnabled.includes(condition1.id));
  assert.ok(delta.actionsHidden.includes(continueButton.id));
});
