import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPageIdentity } from '../src/preprocess/pageIdentity.js';
import { discoverInputs } from '../src/preprocess/inputDiscovery.js';
import { discoverGroups } from '../src/preprocess/groupDiscovery.js';
import { scannerFor } from '../src/preprocess/scanners/registry.js';
import { computeStateDelta } from '../src/preprocess/stateDelta.js';
import { normalizeObservation } from '../src/preprocess/observation.js';
import { preprocessPage } from '../src/preprocess/pagePreprocessor.js';
import { projectPageState } from '../src/preprocess/stateProjection.js';

const snapshot = {
  page: 'Synthetic Filing Page',
  url: 'https://example.test/app/#/filing/reasons?volatile=1',
  title: 'Synthetic App',
  dom: { tag: 'main', label: 'Synthetic Filing Page', children: [
    { tag: 'fieldset', label: 'Filing reason', children: [
      { tag: 'input', type: 'radio', name: 'reason', value: 'A', label: 'Reason A', disabled: false, hidden: false },
      { tag: 'input', type: 'radio', name: 'reason', value: 'B', label: 'Reason B', disabled: false, hidden: false },
      { tag: 'input', type: 'checkbox', name: 'condition1', value: 'on', label: 'Condition 1', disabled: true, hidden: false },
      { tag: 'input', type: 'checkbox', name: 'condition2', value: 'on', label: 'Condition 2', disabled: true, hidden: false }
    ]},
    { tag: 'section', label: 'Details', children: [
      { tag: 'input', type: 'hidden', name: 'technicalToken', value: 'x', label: 'technicalToken', hidden: true },
      { tag: 'input', type: 'date', name: 'filingDate', value: '', label: 'Filing date', placeholder: 'DD/MM/YYYY', disabled: false, hidden: false },
      { tag: 'input', type: 'text', role: 'combobox', name: 'city', value: '', label: 'City', autocomplete: 'off', disabled: false, hidden: false },
      { tag: 'select', name: 'state', value: '', label: 'State', options: ['KA', 'TN'], disabled: false, hidden: false }
    ]},
    { tag: 'button', type: 'button', name: 'continue', label: 'Continue', disabled: false, hidden: false }
  ]},
  values: { reason: 'A', filingDate: '', city: '', state: '' },
  regions: { 'Filing reason': { visible: true }, Details: { visible: true } }
};

test('buildPageIdentity is stable and route-aware', () => {
  const identity = buildPageIdentity(snapshot);
  assert.equal(identity.route, '/app/#/filing/reasons');
  assert.equal(identity.mainLabel, 'Synthetic Filing Page');
  assert.match(identity.id, /^page:/);
});

test('discoverInputs preserves parent region, ignores hidden technical fields and classifies behavioral input type', () => {
  const pageId = buildPageIdentity(snapshot).id;
  const inputs = discoverInputs(snapshot.dom, pageId);
  assert.equal(inputs.find((x) => x.label === 'Reason B').parentRegionLabel, 'Filing reason');
  assert.equal(inputs.find((x) => x.label === 'Filing date').type, 'date');
  assert.equal(inputs.find((x) => x.label === 'City').type, 'autocomplete');
  assert.equal(inputs.find((x) => x.label === 'Continue').type, 'button');
  assert.equal(inputs.some((x) => x.name === 'technicalToken'), false);
});

test('discoverGroups keeps native radio group and labelled checkbox cluster', () => {
  const pageId = buildPageIdentity(snapshot).id;
  const inputs = discoverInputs(snapshot.dom, pageId);
  const groups = discoverGroups(inputs, pageId);
  const radio = groups.find((g) => g.groupType === 'radio');
  const checks = groups.find((g) => g.groupType === 'checkbox');
  assert.equal(radio.memberInputIds.length, 2);
  assert.equal(radio.label, 'Filing reason');
  assert.equal(checks.memberInputIds.length, 2);
});

test('scanner registry produces type-specific user-equivalent actions', () => {
  const pageId = buildPageIdentity(snapshot).id;
  const inputs = discoverInputs(snapshot.dom, pageId);
  const radio = inputs.find((x) => x.label === 'Reason B');
  const date = inputs.find((x) => x.label === 'Filing date');
  const auto = inputs.find((x) => x.label === 'City');
  assert.deepEqual(scannerFor(radio).actions(radio).map((x) => x.kind), ['select']);
  assert.ok(scannerFor(date).actions(date).some((x) => x.kind === 'type' && x.purpose === 'probe-invalid-format'));
  assert.ok(scannerFor(auto).actions(auto).some((x) => x.kind === 'type' && x.purpose === 'probe-suggestions'));
});

test('computeStateDelta captures dependent input/action/validation/output changes', () => {
  const before = { inputs: { B: { value: false, enabled: true, visible: true }, C1: { value: false, enabled: false, visible: true }, continue: { type: 'button', enabled: true, visible: true } }, regions: {}, validations: [], options: {} };
  const after = { inputs: { B: { value: true, enabled: true, visible: true }, C1: { value: false, enabled: true, visible: true }, continue: { type: 'button', enabled: false, visible: false }, C2: { value: false, enabled: true, visible: true } }, regions: {}, validations: ['Select at least one condition'], options: { city: ['Bangalore'] } };
  const delta = computeStateDelta(before, after);
  assert.ok(delta.inputValuesChanged.some((x) => x.inputId === 'B'));
  assert.ok(delta.inputsEnabled.includes('C1'));
  assert.ok(delta.inputsAdded.includes('C2'));
  assert.ok(delta.actionsHidden.includes('continue'));
  assert.deepEqual(delta.validationMessagesAdded, ['Select at least one condition']);
  assert.deepEqual(delta.optionsAdded.city, ['Bangalore']);
});

test('normalizeObservation preserves action, raw execution trace and normalized result', () => {
  const observation = normalizeObservation({
    pageId: 'page:x', inputId: 'input:B', groupId: 'group:r', beforeStateId: 'state:0', afterStateId: 'state:1',
    action: { id: 'a1', inputId: 'input:B', kind: 'select', value: 'B', safety: 'safe', purpose: 'enumerate-option' },
    executionTrace: { browserEvents: [{ name: 'change' }], functions: [{ name: 'handler' }], network: [{ url: '/api' }], callbacks: [] },
    result: { inputsEnabled: ['C1'] }
  });
  assert.equal(observation.action.kind, 'select');
  assert.equal(observation.executionTrace.functions[0].name, 'handler');
  assert.deepEqual(observation.result.inputsEnabled, ['C1']);
});

test('preprocessPage returns page identity, hierarchy, groups and scanner action plans', () => {
  const result = preprocessPage(snapshot);
  assert.equal(result.page.mainLabel, 'Synthetic Filing Page');
  assert.ok(result.inputs.length >= 8);
  assert.ok(result.groups.some((g) => g.groupType === 'radio'));
  assert.ok(result.actionPlans.some((p) => p.inputLabel === 'Filing date'));
});

test('projectPageState maps captured label values onto stable normalized input ids', () => {
  const model = preprocessPage(snapshot);
  const state = projectPageState({ ...snapshot, values: { ...snapshot.values, 'Reason A': 'A', 'Reason B': null } }, model);
  const reasonA = model.inputs.find((x) => x.label === 'Reason A');
  const reasonB = model.inputs.find((x) => x.label === 'Reason B');
  assert.equal(state.inputs[reasonA.id].value, 'A');
  assert.equal(state.inputs[reasonB.id].value, null);
});

test('preprocessPage exposes a nested input hierarchy from labelled ancestor paths', () => {
  const result = preprocessPage(snapshot);
  const filing = result.hierarchy.regions.find((r) => r.label === 'Filing reason');
  const details = result.hierarchy.regions.find((r) => r.label === 'Details');
  assert.ok(filing.inputIds.length >= 4);
  assert.ok(details.inputIds.length >= 3);
});

test('projectPageState maps dynamic autocomplete options and validations to normalized state', () => {
  const model = preprocessPage(snapshot);
  const state = projectPageState({
    ...snapshot,
    validations: ['Choose a city from the list'],
    options: { City: ['Bangalore', 'Bangkok'] }
  }, model);
  const city = model.inputs.find((x) => x.label === 'City');
  assert.deepEqual(state.options[city.id], ['Bangalore', 'Bangkok']);
  assert.deepEqual(state.validations, ['Choose a city from the list']);
});
