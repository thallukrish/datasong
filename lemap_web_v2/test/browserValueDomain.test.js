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

test('Angular Material opens the canonical mat-select host instead of depending on internal trigger classes', async () => {
  let hostClicked = false;
  let escaped = false;
  let probe = null;
  const roleOptions = [
    { isVisible: async () => hostClicked, innerText: async () => '2026-27' },
    { isVisible: async () => hostClicked, innerText: async () => '2025-26' }
  ];
  const host = {
    click: async () => { hostClicked = true; },
    locator: (selector) => {
      if (selector === 'option') return { allTextContents: async () => [] };
      throw new Error(`internal Angular selector should not be used: ${selector}`);
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
  assert.equal(hostClicked, true);
  assert.equal(escaped, true);
  assert.equal(probe.sourceAdapter, 'angular-material');
  assert.equal(probe.adapterResolved, true);
  assert.equal(probe.adapterName, 'angular-material');
  assert.equal(probe.adapterOpenAttempted, true);
  assert.equal(probe.hostClickSucceeded, true);
  assert.equal(probe.hostDomClickSucceeded, false);
});

test('Angular Material falls back to DOM click on the host when Playwright click cannot open it', async () => {
  let domClicked = false;
  let probe = null;
  const host = {
    click: async () => { throw new Error('locator.click: Timeout 1000ms exceeded because another element intercepts pointer events'); },
    evaluate: async (fn) => {
      domClicked = true;
      fn({ click() {} });
    },
    locator: (selector) => {
      if (selector === 'option') return { allTextContents: async () => [] };
      throw new Error(`internal Angular selector should not be used: ${selector}`);
    }
  };
  const option = { isVisible: async () => domClicked, innerText: async () => '2026-27' };
  const page = {
    locator: (selector) => {
      if (selector === '#assessmentYear') return host;
      if (selector === '[role="option"]') return { count: async () => 1, nth: () => option };
      throw new Error(`unexpected selector: ${selector}`);
    },
    waitForTimeout: async () => {},
    keyboard: { press: async () => {} }
  };
  const entity = {
    id: 'year',
    type: 'ui_control',
    structural: {
      controlType: 'select',
      tag: 'mat-select',
      role: 'combobox',
      domId: 'assessmentYear',
      sourceAdapter: 'angular-material'
    }
  };

  assert.deepEqual(await enumerateEntityValueDomain(page, entity, { onProbe: async (event) => { probe = event; } }), ['2026-27']);
  assert.equal(domClicked, true);
  assert.equal(probe.hostClickSucceeded, false);
  assert.equal(probe.hostClickErrorCode, 'POINTER_INTERCEPTED');
  assert.equal(probe.hostDomClickSucceeded, true);
  assert.equal(JSON.stringify(probe).includes('another element intercepts pointer events'), false);
});
