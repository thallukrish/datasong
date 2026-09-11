import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntityLocator } from '../src/execution/entityLocator.js';
import { executeControlAction } from '../src/execution/controlExecutor.js';

function control(id, structural = {}) {
  return {
    id,
    type: 'ui_control',
    name: structural.label || id,
    structural: {
      controlType: structural.controlType || 'text',
      tag: structural.tag || 'input',
      domId: structural.domId || '',
      name: structural.name || '',
      label: structural.label || '',
      role: structural.role || '',
      path: structural.path || [],
      disabled: structural.disabled === true
    },
    semantic: {},
    links: []
  };
}

function fakePage() {
  const calls = [];
  const locator = (selector) => ({
    selector,
    click: async () => calls.push(['click', selector]),
    fill: async (value) => calls.push(['fill', selector, value]),
    selectOption: async (value) => calls.push(['selectOption', selector, value]),
    check: async () => calls.push(['check', selector]),
    uncheck: async () => calls.push(['uncheck', selector])
  });
  return { page: { locator }, calls };
}

test('resolveEntityLocator prefers a unique DOM id anchor', () => {
  const entity = control('control:income', { domId: 'grossIncome', label: 'Gross income' });
  assert.deepEqual(resolveEntityLocator(entity), {
    strategy: 'css',
    selector: '#grossIncome'
  });
});

test('resolveEntityLocator falls back to stable name and label anchors without using runtime values', () => {
  const byName = control('control:status', { name: 'filingStatus', label: 'Filing status' });
  const byLabel = control('control:reason', { label: 'Reason' });

  assert.deepEqual(resolveEntityLocator(byName), {
    strategy: 'css',
    selector: '[name="filingStatus"]'
  });
  assert.deepEqual(resolveEntityLocator(byLabel), {
    strategy: 'label',
    label: 'Reason'
  });
});

test('executeControlAction fills a visible actionable text control and returns local runtime state', async () => {
  const { page, calls } = fakePage();
  const entity = control('control:income', { domId: 'income', controlType: 'text' });
  const context = { visibleEntityIds: ['control:income'] };

  const result = await executeControlAction({
    page,
    entity,
    activeFrame: context,
    action: { type: 'fill', value: '1250' }
  });

  assert.deepEqual(calls, [['fill', '#income', '1250']]);
  assert.deepEqual(result.instancePatch, { entityId: 'control:income', value: '1250' });
  assert.equal('value' in entity.structural, false);
});

test('executeControlAction supports click, select and checkbox actions', async () => {
  const { page, calls } = fakePage();
  const visible = ['button:next', 'select:year', 'check:agree'];

  await executeControlAction({
    page,
    entity: control('button:next', { domId: 'next', controlType: 'button', tag: 'button' }),
    activeFrame: { visibleEntityIds: visible },
    action: { type: 'click' }
  });
  await executeControlAction({
    page,
    entity: control('select:year', { domId: 'year', controlType: 'select', tag: 'select' }),
    activeFrame: { visibleEntityIds: visible },
    action: { type: 'select', value: '2026' }
  });
  await executeControlAction({
    page,
    entity: control('check:agree', { domId: 'agree', controlType: 'checkbox' }),
    activeFrame: { visibleEntityIds: visible },
    action: { type: 'check', value: true }
  });

  assert.deepEqual(calls, [
    ['click', '#next'],
    ['selectOption', '#year', '2026'],
    ['check', '#agree']
  ]);
});

test('executeControlAction rejects controls outside the active frame and disabled controls', async () => {
  const { page } = fakePage();

  await assert.rejects(() => executeControlAction({
    page,
    entity: control('control:hidden', { domId: 'hidden' }),
    activeFrame: { visibleEntityIds: ['control:other'] },
    action: { type: 'fill', value: 'secret' }
  }), /active frame/i);

  await assert.rejects(() => executeControlAction({
    page,
    entity: control('control:disabled', { domId: 'disabled', disabled: true }),
    activeFrame: { visibleEntityIds: ['control:disabled'] },
    action: { type: 'click' }
  }), /disabled/i);
});

test('executeControlAction rejects unsupported actions and non-control entities', async () => {
  const { page } = fakePage();

  await assert.rejects(() => executeControlAction({
    page,
    entity: control('control:x', { domId: 'x' }),
    activeFrame: { visibleEntityIds: ['control:x'] },
    action: { type: 'dance' }
  }), /unsupported/i);

  await assert.rejects(() => executeControlAction({
    page,
    entity: { id: 'container:1', type: 'container', structural: {}, links: [] },
    activeFrame: { visibleEntityIds: ['container:1'] },
    action: { type: 'click' }
  }), /ui_control/i);
});
