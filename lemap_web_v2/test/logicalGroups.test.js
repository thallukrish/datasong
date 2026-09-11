import test from 'node:test';
import assert from 'node:assert/strict';
import { inferLogicalGroups } from '../src/orchestrator/logicalGroups.js';

function entity(id, type, structural = {}, name = id, links = []) {
  return { id, type, name, structural, semantic: {}, links };
}

function contains(parent, child) {
  parent.links.push({ id: child.id, relationship: 'contains' });
  child.links.push({ id: parent.id, relationship: 'partOf' });
}

test('radio controls inside mat-radio-group become one exactlyOne logical group', () => {
  const page = entity('page:1', 'page');
  const owner = entity('container:years', 'container', { tag: 'mat-radio-group' }, 'Assessment Year');
  const a = entity('radio:a', 'ui_control', { controlType: 'radio', label: '2024-25' }, '2024-25');
  const b = entity('radio:b', 'ui_control', { controlType: 'radio', label: '2025-26' }, '2025-26');
  contains(page, owner);
  contains(owner, a);
  contains(owner, b);

  const result = inferLogicalGroups({ page, entities: [page, owner, a, b] });

  assert.equal(result.groups.length, 1);
  const group = result.groups[0];
  assert.equal(group.type, 'ui_group');
  assert.equal(group.name, 'Assessment Year');
  assert.equal(group.structural.controlType, 'radio');
  assert.equal(group.structural.cardinality, 'exactlyOne');
  assert.deepEqual(group.structural.memberIds, ['radio:a', 'radio:b']);
  assert.ok(group.links.some((link) => link.relationship === 'ownedBy' && link.id === owner.id));
  assert.ok(a.links.some((link) => link.relationship === 'memberOf' && link.id === group.id));
  assert.ok(b.links.some((link) => link.relationship === 'memberOf' && link.id === group.id));
});

test('same-name native radios under one owner are grouped even without a special container tag', () => {
  const page = entity('page:1', 'page');
  const owner = entity('container:section', 'container', { tag: 'section' }, 'Filing Status');
  const yes = entity('radio:yes', 'ui_control', { controlType: 'radio', name: 'filingStatus', label: 'Yes' }, 'Yes');
  const no = entity('radio:no', 'ui_control', { controlType: 'radio', name: 'filingStatus', label: 'No' }, 'No');
  contains(page, owner);
  contains(owner, yes);
  contains(owner, no);

  const result = inferLogicalGroups({ page, entities: [page, owner, yes, no] });

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].structural.cardinality, 'exactlyOne');
});

test('checkbox groups are zeroOrMore', () => {
  const page = entity('page:1', 'page');
  const owner = entity('fieldset:1', 'container', { tag: 'fieldset' }, 'Notifications');
  const email = entity('check:email', 'ui_control', { controlType: 'checkbox', name: 'notify', label: 'Email' }, 'Email');
  const sms = entity('check:sms', 'ui_control', { controlType: 'checkbox', name: 'notify', label: 'SMS' }, 'SMS');
  contains(page, owner);
  contains(owner, email);
  contains(owner, sms);

  const result = inferLogicalGroups({ page, entities: [page, owner, email, sms] });

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].structural.cardinality, 'zeroOrMore');
});

test('unrelated controls are not grouped just because they share a parent', () => {
  const page = entity('page:1', 'page');
  const owner = entity('container:1', 'container', { tag: 'section' }, 'Profile');
  const a = entity('radio:a', 'ui_control', { controlType: 'radio', name: 'statusA', label: 'A' }, 'A');
  const b = entity('radio:b', 'ui_control', { controlType: 'radio', name: 'statusB', label: 'B' }, 'B');
  contains(page, owner);
  contains(owner, a);
  contains(owner, b);

  const result = inferLogicalGroups({ page, entities: [page, owner, a, b] });

  assert.equal(result.groups.length, 0);
});

test('group inference is deterministic and does not duplicate groups or member links', () => {
  const page = entity('page:1', 'page');
  const owner = entity('fieldset:1', 'container', { tag: 'fieldset' }, 'Choice');
  const a = entity('radio:a', 'ui_control', { controlType: 'radio', name: 'choice', label: 'A' }, 'A');
  const b = entity('radio:b', 'ui_control', { controlType: 'radio', name: 'choice', label: 'B' }, 'B');
  contains(page, owner);
  contains(owner, a);
  contains(owner, b);

  const first = inferLogicalGroups({ page, entities: [page, owner, a, b] });
  const second = inferLogicalGroups({ page: first.page, entities: first.entities });

  assert.equal(first.groups.length, 1);
  assert.equal(second.groups.length, 1);
  assert.equal(first.groups[0].id, second.groups[0].id);
  assert.equal(second.entities.find((item) => item.id === a.id).links.filter((link) => link.relationship === 'memberOf').length, 1);
});
