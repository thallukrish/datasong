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
    structural: { controlType: 'select', label: 'Assessment year' },
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
