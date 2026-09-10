import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntityQuestion,
  ignoredSourceEntityIds,
  resolveEntityAnswer,
  selectNextUserInput,
  selectReusableUserInput,
  selectWorkflowContinuation
} from '../src/agent/entityFlow.js';
import { createInstanceGraph, upsertInstanceValue } from '../src/graph/instanceGraph.js';

const page = { id: 'page:1', name: 'Setup', type: 'page', structural: {}, semantic: {}, links: [] };
const year = { id: 'field:year', name: 'Assessment Year', type: 'ui_control', structural: { controlType: 'select', values: ['2026-27', '2025-26'], value: '', visible: true, disabled: false }, semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which year?' }, links: [] };
const online = { id: 'field:online', name: 'Online', type: 'ui_control', structural: { controlType: 'radio', value: 'online', visible: true, disabled: true, checked: false }, semantic: {}, links: [{ id: 'group:mode', relationship: 'partOf' }] };
const offline = { id: 'field:offline', name: 'Offline', type: 'ui_control', structural: { controlType: 'radio', value: 'offline', visible: true, disabled: true, checked: false }, semantic: {}, links: [{ id: 'group:mode', relationship: 'partOf' }] };
const mode = { id: 'group:mode', name: 'Filing Mode', type: 'group', structural: { groupType: 'radio', cardinality: 'exactlyOne', values: ['Online', 'Offline'], value: null, visible: true, disabled: true }, semantic: { interaction: 'user_input', relevantToGoal: true, required: true, selectionRule: 'exactlyOne', question: 'How do you want to file?' }, links: [{ id: 'field:online', relationship: 'contains' }, { id: 'field:offline', relationship: 'contains' }] };
const next = { id: 'button:next', name: 'Continue', type: 'ui_control', structural: { controlType: 'button', visible: true, disabled: false }, semantic: { interaction: 'navigation', relevantToGoal: true, workflowRole: 'continue', consequence: 'reversible' }, links: [] };

test('next input is a relevant required enabled entity with no instance', () => {
  const entities = [page, year, online, offline, mode, next];
  const instances = createInstanceGraph();
  assert.equal(selectNextUserInput(entities, instances)?.id, 'field:year');
  upsertInstanceValue(instances, 'field:year', '2026-27');
  assert.equal(selectNextUserInput(entities, instances), null);

  const enabledMode = { ...mode, structural: { ...mode.structural, disabled: false } };
  assert.equal(selectNextUserInput([page, year, online, offline, enabledMode, next], instances)?.id, 'group:mode');
});

test('structural group always shadows member controls even if stale member semantics say user input', () => {
  const instances = createInstanceGraph([{ id: 'instance:year', type: 'instance', value: '2026-27', links: [{ id: 'field:year', relationship: 'instanceOf' }] }]);
  const unresolvedMode = { ...mode, structural: { ...mode.structural, disabled: false }, semantic: {} };
  const enabledOnline = { ...online, structural: { ...online.structural, disabled: false }, semantic: { interaction: 'user_input', relevantToGoal: true, required: true } };
  const enabledOffline = { ...offline, structural: { ...offline.structural, disabled: false }, semantic: { interaction: 'user_input', relevantToGoal: true, required: true } };
  assert.equal(selectNextUserInput([page, year, enabledOnline, enabledOffline, unresolvedMode, next], instances), null);

  const enabledMode = { ...mode, structural: { ...mode.structural, disabled: false } };
  assert.equal(selectNextUserInput([page, year, enabledOnline, enabledOffline, enabledMode, next], instances)?.id, 'group:mode');
});

test('stored instance reuse prefers the group over member controls', () => {
  const instances = createInstanceGraph([
    { id: 'instance:year', type: 'instance', value: '2026-27', links: [{ id: 'field:year', relationship: 'instanceOf' }] },
    { id: 'instance:mode', type: 'instance', value: 'Online', links: [{ id: 'group:mode', relationship: 'instanceOf' }] },
    { id: 'instance:online', type: 'instance', value: true, links: [{ id: 'field:online', relationship: 'instanceOf' }] }
  ]);
  const appliedYear = { ...year, structural: { ...year.structural, value: '2026-27' } };
  const enabledMode = { ...mode, structural: { ...mode.structural, disabled: false } };
  const enabledOnline = { ...online, structural: { ...online.structural, disabled: false }, semantic: { interaction: 'user_input', relevantToGoal: true, required: true } };
  const enabledOffline = { ...offline, structural: { ...offline.structural, disabled: false }, semantic: { interaction: 'user_input', relevantToGoal: true, required: true } };
  const reusable = selectReusableUserInput([page, appliedYear, enabledOnline, enabledOffline, enabledMode, next], instances);
  assert.equal(reusable?.entity.id, 'group:mode');
  assert.equal(reusable?.instance.value, 'Online');
});

test('stored instance reuse skips an entity already applied in the current page state', () => {
  const instances = createInstanceGraph([
    { id: 'instance:year', type: 'instance', value: '2026-27 (Current A.Y.)', links: [{ id: 'field:year', relationship: 'instanceOf' }] }
  ]);
  const customCombobox = { ...year, structural: { ...year.structural, controlType: 'autocomplete', value: '', values: ['2025-26', '2026-27 (Current A.Y.)'] } };
  assert.equal(selectReusableUserInput([page, customCombobox], instances)?.entity.id, 'field:year');
  assert.equal(selectReusableUserInput([page, customCombobox], instances, new Set(['field:year'])), null);
});

test('exactly-one group question accepts one option', () => {
  const question = buildEntityQuestion(mode, [page, online, offline, mode]);
  assert.equal(question.selectionRule, 'exactlyOne');
  assert.equal(question.multiple, false);
  assert.match(question.instruction, /choose one/i);
  assert.deepEqual(question.options, ['Online', 'Offline']);
  assert.equal(resolveEntityAnswer(question, '2'), 'Offline');
});

test('checkbox group question accepts multiple selections using semantic rule', () => {
  const conditions = {
    id: 'group:conditions',
    name: 'Applicable Conditions',
    type: 'group',
    structural: { groupType: 'checkbox', cardinality: 'zeroOrMore', values: ['Condition A', 'Condition B', 'Condition C'] },
    semantic: { interaction: 'user_input', relevantToGoal: true, required: true, selectionRule: 'atLeastOne', question: 'Which conditions apply?' },
    links: []
  };
  const question = buildEntityQuestion(conditions, [conditions]);
  assert.equal(question.selectionRule, 'atLeastOne');
  assert.equal(question.multiple, true);
  assert.match(question.instruction, /one or more/i);
  assert.deepEqual(resolveEntityAnswer(question, '1, 3'), ['Condition A', 'Condition C']);
  assert.deepEqual(resolveEntityAnswer(question, 'Condition A, Condition B'), ['Condition A', 'Condition B']);
  assert.equal(resolveEntityAnswer(question, 'none'), null);
});

test('zero-or-more structural cardinality maps to anyOf and accepts none explicitly', () => {
  const conditions = {
    id: 'group:conditions',
    name: 'Applicable Conditions',
    type: 'group',
    structural: { groupType: 'checkbox', cardinality: 'zeroOrMore', values: ['Condition A', 'Condition B'] },
    semantic: { interaction: 'user_input', relevantToGoal: true, required: true },
    links: []
  };
  const question = buildEntityQuestion(conditions, [conditions]);
  assert.equal(question.selectionRule, 'anyOf');
  assert.deepEqual(resolveEntityAnswer(question, 'none'), []);
});

test('finite questions expose structural options and resolve number locally', () => {
  const question = buildEntityQuestion(year, [page, year]);
  assert.deepEqual(question.options, ['2026-27', '2025-26']);
  assert.equal(resolveEntityAnswer(question, '2'), '2025-26');
  assert.equal(resolveEntityAnswer(question, '2026-27'), '2026-27');
});

test('group interaction ignores direct member state changes as user instance state', () => {
  assert.deepEqual(ignoredSourceEntityIds(mode), ['group:mode', 'field:online', 'field:offline']);
});

test('workflow continuation comes directly from safe entity semantics', () => {
  assert.equal(selectWorkflowContinuation([page, year, mode, next])?.id, 'button:next');
  const commit = { ...next, id: 'button:submit', name: 'Submit', semantic: { ...next.semantic, workflowRole: 'commit', consequence: 'commit' } };
  assert.equal(selectWorkflowContinuation([page, commit]), null);
});
