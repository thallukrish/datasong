import test from 'node:test';
import assert from 'node:assert/strict';
import { memberEntityForGroupValue, entityInteractionKind, optionCandidateMatches, executeEntityAction, applyEntityValue } from '../src/agent/entityBrowserActions.js';

const online = { id: 'field:online', name: 'Online', type: 'ui_control', structural: { controlType: 'radio', value: 'online' }, links: [] };
const offline = { id: 'field:offline', name: 'Offline', type: 'ui_control', structural: { controlType: 'radio', value: 'offline' }, links: [] };
const group = { id: 'group:mode', name: 'Filing Mode', type: 'group', structural: { groupType: 'radio', values: ['Online', 'Offline'] }, links: [{ id: 'field:online', relationship: 'contains' }, { id: 'field:offline', relationship: 'contains' }] };

test('group value maps to the corresponding member control', () => {
  const entities = [group, online, offline];
  assert.equal(memberEntityForGroupValue(entities, group, 'Online')?.id, 'field:online');
  assert.equal(memberEntityForGroupValue(entities, group, 'offline')?.id, 'field:offline');
});

test('entity interaction kind follows structural control type', () => {
  assert.equal(entityInteractionKind({ structural: { controlType: 'select', tag: 'mat-select', role: 'combobox' } }), 'combobox');
  assert.equal(entityInteractionKind({ structural: { controlType: 'select', tag: 'select' } }), 'native_select');
  assert.equal(entityInteractionKind({ structural: { controlType: 'text', tag: 'input' } }), 'fillable');
});

test('combobox option matching uses the same visible/value evidence captured during discovery', () => {
  assert.equal(optionCandidateMatches({ text: '2026-27\n(Current A.Y.)' }, '2026-27 (Current A.Y.)'), true);
  assert.equal(optionCandidateMatches({ ariaLabel: 'Assessment year', dataValue: '2026-27 (Current A.Y.)' }, '2026-27 (Current A.Y.)'), true);
  assert.equal(optionCandidateMatches({ value: '2026-27' }, '2026-27'), true);
  assert.equal(optionCandidateMatches({ text: '2025-26' }, '2026-27 (Current A.Y.)'), false);
});

test('role-based radio resolves by accessible name before generic shared name', async () => {
  const calls = [];
  const missing = { count: async () => 0, nth: () => missing };
  const visible = {
    count: async () => 1,
    nth: () => visible,
    isVisible: async () => true,
    isChecked: async () => false,
    check: async () => { calls.push(['check']); }
  };
  const page = {
    locator: (selector) => { calls.push(['locator', selector]); return missing; },
    getByRole: (role, options) => {
      calls.push(['role', role, options]);
      return role === 'radio' && options?.name === 'Reason B' ? visible : missing;
    },
    getByLabel: () => missing
  };

  await applyEntityValue(page, [], {
    id: 'field:reason-b',
    name: 'Reason B',
    type: 'ui_control',
    structural: { controlType: 'radio', role: 'radio', name: 'shared-group-name' }
  }, true);

  assert.ok(calls.some((call) => call[0] === 'role' && call[1] === 'radio' && call[2]?.name === 'Reason B'));
  assert.ok(calls.some((call) => call[0] === 'check'));
});

test('stale action locator is recoverable instead of aborting the run', async () => {
  const emptyLocator = {
    count: async () => 0,
    nth: () => emptyLocator
  };
  const page = {
    url: () => 'https://example.test/workflow',
    locator: () => emptyLocator,
    getByRole: () => emptyLocator,
    getByLabel: () => emptyLocator
  };
  const result = await executeEntityAction(page, {
    id: 'field:stale',
    name: 'Proceed',
    type: 'ui_control',
    structural: { controlType: 'button', domId: 'old-dom-id' }
  });
  assert.deepEqual(result, { executed: false, reason: 'locator_miss' });
});
