import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateEntityValueDomain } from '../src/browser/valueDomain.js';

test('returns native select option labels without duplication', async () => {
  const page = {
    getByLabel: () => ({
      locator: () => ({ allTextContents: async () => ['Select', '2026-27', '2025-26', '2025-26'] })
    })
  };
  const entity = {
    id: 'year',
    type: 'ui_control',
    name: 'Assessment year',
    structural: { controlType: 'select', label: 'Assessment year', sourceAdapter: 'native-control' },
    semantic: {},
    links: []
  };

  assert.deepEqual(await enumerateEntityValueDomain(page, entity), ['Select', '2026-27', '2025-26']);
});

test('reuses known structural values without browser access', async () => {
  const entity = {
    id: 'mode',
    type: 'ui_control',
    name: 'Mode',
    structural: { controlType: 'select', values: ['Online', 'Offline'] },
    semantic: {},
    links: []
  };

  assert.deepEqual(await enumerateEntityValueDomain({}, entity), ['Online', 'Offline']);
});

test('delegates Angular Material value-domain opening to the framework adapter', async () => {
  let hostClicked = false;
  let triggerClicked = false;
  let escaped = false;
  let probe = null;
  const roleOptions = [
    { isVisible: async () => triggerClicked, innerText: async () => '2026-27' },
    { isVisible: async () => triggerClicked, innerText: async () => '2025-26' }
  ];
  const host = {
    click: async () => { hostClicked = true; throw new Error('host is not the interactive trigger'); },
    locator: (selector) => {
      assert.match(selector, /mat-select-trigger|mat-mdc-select-trigger/);
      return { first: () => ({ click: async () => { triggerClicked = true; } }) };
    }
  };
  const page = {
    locator: (selector) => {
      if (selector === '#assessmentYear') return host;
      if (selector === '[role="option"]') {
        return { count: async () => roleOptions.length, nth: (index) => roleOptions[index] };
      }
      throw new Error(`unexpected selector: ${selector}`);
    },
    waitForTimeout: async () => {},
    keyboard: { press: async (key) => { assert.equal(key, 'Escape'); escaped = true; } }
  };
  const entity = {
    id: 'year',
    type: 'ui_control',
    name: 'Assessment year',
    structural: {
      controlType: 'select',
      tag: 'mat-select',
      role: 'combobox',
      domId: 'assessmentYear',
      label: 'Assessment year',
      sourceAdapter: 'angular-material'
    },
    semantic: {},
    links: []
  };

  assert.deepEqual(await enumerateEntityValueDomain(page, entity, { onProbe: async (event) => { probe = event; } }), ['2026-27', '2025-26']);
  assert.equal(hostClicked, false);
  assert.equal(triggerClicked, true);
  assert.equal(escaped, true);
  assert.equal(probe.sourceAdapter, 'angular-material');
  assert.equal(probe.adapterResolved, true);
  assert.equal(probe.adapterName, 'angular-material');
  assert.equal(probe.adapterOpenAttempted, true);
  assert.equal(probe.triggerFound, true);
  assert.equal(probe.triggerClickSucceeded, true);
});
