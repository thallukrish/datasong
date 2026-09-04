import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStructuralEntities } from '../src/graph/structuralEntityBuilder.js';

const snapshot = {
  page: 'Setup',
  title: 'Setup',
  url: 'https://example.test/setup',
  overlay: { active: false },
  dom: {
    tag: 'body', label: 'Setup', hidden: false, children: [
      { control: true, tag: 'button', domId: 'menu', name: '', label: 'Menu', type: '', role: '', value: null, hidden: false, disabled: false, options: [] },
      { tag: 'main', label: 'Setup', hidden: false, children: [
        { control: true, tag: 'select', domId: 'year', name: 'year', label: 'Assessment Year', type: '', role: '', value: '', hidden: false, disabled: false, options: ['2026-27', '2025-26'] },
        { tag: 'fieldset', label: 'Filing Mode', hidden: false, children: [
          { control: true, tag: 'input', domId: 'online', name: 'mode', label: 'Online', type: 'radio', role: '', value: 'online', checked: false, hidden: false, disabled: false, options: [] },
          { control: true, tag: 'input', domId: 'offline', name: 'mode', label: 'Offline', type: 'radio', role: '', value: 'offline', checked: false, hidden: false, disabled: false, options: [] }
        ]},
        { control: true, tag: 'button', domId: 'continue', name: '', label: 'Continue', type: '', role: '', value: null, hidden: false, disabled: true, options: [] },
        { control: true, tag: 'a', domId: 'help', name: '', label: 'Help', type: '', role: 'link', href: '/help', value: null, hidden: false, disabled: false, options: [] }
      ]}
    ]
  }
};

test('browser structure becomes one array of page, group and ui-control entities', () => {
  const { entities, pageId } = buildStructuralEntities(snapshot);
  const page = entities.find((entity) => entity.id === pageId);
  const year = entities.find((entity) => entity.name === 'Assessment Year');
  const group = entities.find((entity) => entity.type === 'group' && entity.name === 'Filing Mode');
  const online = entities.find((entity) => entity.name === 'Online');
  const offline = entities.find((entity) => entity.name === 'Offline');
  const button = entities.find((entity) => entity.name === 'Continue');
  const link = entities.find((entity) => entity.name === 'Help');

  assert.equal(page.type, 'page');
  assert.equal(year.type, 'ui_control');
  assert.equal(year.structural.controlType, 'select');
  assert.deepEqual(year.structural.values, ['2026-27', '2025-26']);
  assert.equal(group.type, 'group');
  assert.equal(group.structural.groupType, 'radio');
  assert.deepEqual(group.structural.values, ['Online', 'Offline']);
  assert.equal(button.structural.controlType, 'button');
  assert.equal(link.structural.controlType, 'link');
  assert.equal(link.structural.href, '/help');

  assert.ok(page.links.some((item) => item.id === year.id && item.relationship === 'contains'));
  assert.ok(year.links.some((item) => item.id === page.id && item.relationship === 'childOf'));
  assert.ok(group.links.some((item) => item.id === online.id && item.relationship === 'contains'));
  assert.ok(online.links.some((item) => item.id === group.id && item.relationship === 'partOf'));
  assert.ok(group.links.some((item) => item.id === offline.id && item.relationship === 'contains'));
});

test('all rendered controls are entities; semantic model decides local versus global later', () => {
  const { entities } = buildStructuralEntities(snapshot);
  assert.ok(entities.some((entity) => entity.name === 'Menu' && entity.type === 'ui_control'));
  assert.ok(entities.some((entity) => entity.name === 'Assessment Year' && entity.type === 'ui_control'));
});
