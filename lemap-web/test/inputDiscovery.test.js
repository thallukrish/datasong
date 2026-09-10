import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverInputs } from '../src/preprocess/inputDiscovery.js';

function rootWith(control, regionLabel = 'Return setup') {
  return {
    tag: 'body', label: 'Page', children: [
      { tag: 'section', label: regionLabel, children: [control] }
    ]
  };
}

test('stable dom id keeps the same control entity id across rerenders', () => {
  const before = discoverInputs(rootWith({
    control: true,
    tag: 'mat-select',
    role: 'combobox',
    domId: 'assessmentYear',
    name: 'assessmentYear',
    label: 'Assessment year',
    value: '',
    hidden: false
  }), 'entity:page')[0];

  const after = discoverInputs(rootWith({
    control: true,
    tag: 'mat-select',
    role: 'combobox',
    domId: 'assessmentYear',
    name: 'assessmentYear',
    label: 'For which assessment year are you filing?',
    value: '2026-27',
    hidden: false
  }, 'Selected assessment year'), 'entity:page')[0];

  assert.equal(after.id, before.id);
});

test('stable name and radio value distinguish choices when dom id is absent', () => {
  const online = discoverInputs(rootWith({
    control: true,
    tag: 'input',
    type: 'radio',
    name: 'filingMode',
    label: 'Online',
    value: 'online',
    hidden: false
  }), 'entity:page')[0];
  const offline = discoverInputs(rootWith({
    control: true,
    tag: 'input',
    type: 'radio',
    name: 'filingMode',
    label: 'Offline',
    value: 'offline',
    hidden: false
  }), 'entity:page')[0];

  assert.notEqual(online.id, offline.id);
});

test('structural site chrome provenance survives input discovery', () => {
  const profile = discoverInputs(rootWith({
    control: true,
    tag: 'button',
    type: 'button',
    label: 'Example Private Person',
    siteChrome: true,
    hidden: false
  }), 'entity:page')[0];

  assert.equal(profile.siteChrome, true);
});
