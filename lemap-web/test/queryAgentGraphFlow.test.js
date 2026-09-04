import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntityQuestion,
  ignoredSourceEntityIds,
  resolveEntityAnswer,
  selectNextUserInput,
  selectWorkflowContinuation
} from '../src/agent/entityFlow.js';
import { createInstanceGraph, upsertInstanceValue } from '../src/graph/instanceGraph.js';

const page = { id: 'page:1', name: 'Setup', type: 'page', structural: {}, semantic: {}, links: [] };
const year = { id: 'field:year', name: 'Assessment Year', type: 'ui_control', structural: { controlType: 'select', values: ['2026-27', '2025-26'], visible: true, disabled: false }, semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which year?' }, links: [] };
const online = { id: 'field:online', name: 'Online', type: 'ui_control', structural: { controlType: 'radio', value: 'online', visible: true, disabled: true }, semantic: {}, links: [{ id: 'group:mode', relationship: 'partOf' }] };
const offline = { id: 'field:offline', name: 'Offline', type: 'ui_control', structural: { controlType: 'radio', value: 'offline', visible: true, disabled: true }, semantic: {}, links: [{ id: 'group:mode', relationship: 'partOf' }] };
const mode = { id: 'group:mode', name: 'Filing Mode', type: 'group', structural: { groupType: 'radio', values: ['Online', 'Offline'], visible: true, disabled: true }, semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'How do you want to file?' }, links: [{ id: 'field:online', relationship: 'contains' }, { id: 'field:offline', relationship: 'contains' }] };
const next = { id: 'button:next', name: 'Continue', type: 'ui_control', structural: { controlType: 'button', visible: true, disabled: false }, semantic: { interaction: 'navigation', relevantToGoal: true, workflowRole: 'continue' }, links: [] };

test('next input is a relevant required enabled entity with no instance', () => {
  const entities = [page, year, online, offline, mode, next];
  const instances = createInstanceGraph();
  assert.equal(selectNextUserInput(entities, instances)?.id, 'field:year');
  upsertInstanceValue(instances, 'field:year', '2026-27');
  assert.equal(selectNextUserInput(entities, instances), null);

  const enabledMode = { ...mode, structural: { ...mode.structural, disabled: false } };
  assert.equal(selectNextUserInput([page, year, online, offline, enabledMode, next], instances)?.id, 'group:mode');
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

test('workflow continuation comes directly from entity semantics', () => {
  assert.equal(selectWorkflowContinuation([page, year, mode, next])?.id, 'button:next');
});
