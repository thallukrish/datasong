import test from 'node:test';
import assert from 'node:assert/strict';
import { memberEntityForGroupValue, entityInteractionKind } from '../src/agent/entityBrowserActions.js';

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
