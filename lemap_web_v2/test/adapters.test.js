import test from 'node:test';
import assert from 'node:assert/strict';

import { createAdapterRegistry } from '../src/adapters/adapterRegistry.js';
import { angularMaterialAdapter } from '../src/adapters/angularMaterialAdapter.js';
import { nativeControlAdapter } from '../src/adapters/nativeControlAdapter.js';
import { ariaControlAdapter } from '../src/adapters/ariaControlAdapter.js';

function node(tag, attributes = {}, directText = '', children = []) {
  return { tag, attributes, directText, children };
}

const registry = createAdapterRegistry([
  angularMaterialAdapter,
  nativeControlAdapter,
  ariaControlAdapter
]);

test('Angular Material radio becomes a canonical radio control with visible label', () => {
  const radio = node('mat-radio-button', {
    name: 'FilingStatusRadio',
    role: 'radio',
    'aria-checked': 'false'
  }, '', [
    node('span', {}, 'No')
  ]);

  const parsed = registry.parse(radio);

  assert.deepEqual(parsed, {
    entityType: 'ui_control',
    controlType: 'radio',
    tag: 'mat-radio-button',
    role: 'radio',
    name: 'FilingStatusRadio',
    label: 'No',
    href: '',
    disabled: false,
    required: false,
    sourceAdapter: 'angular-material'
  });
});

test('native controls map to canonical control types without exposing values', () => {
  const input = node('input', {
    type: 'text',
    name: 'firstName',
    placeholder: 'First name'
  });
  const link = node('a', { href: '/next' }, 'Continue');

  assert.deepEqual(registry.parse(input), {
    entityType: 'ui_control',
    controlType: 'text',
    tag: 'input',
    role: '',
    name: 'firstName',
    label: 'First name',
    href: '',
    disabled: false,
    required: false,
    sourceAdapter: 'native-control'
  });

  assert.deepEqual(registry.parse(link), {
    entityType: 'ui_control',
    controlType: 'link',
    tag: 'a',
    role: '',
    name: '',
    label: 'Continue',
    href: '/next',
    disabled: false,
    required: false,
    sourceAdapter: 'native-control'
  });
});

test('ARIA controls are parsed only when their role is understood', () => {
  const radio = node('div', { role: 'radio', 'aria-label': 'Individual' });
  const unknown = node('div', { role: 'mystery-widget', 'aria-label': 'Thing' });

  assert.equal(registry.parse(radio)?.controlType, 'radio');
  assert.equal(registry.parse(radio)?.label, 'Individual');
  assert.equal(registry.parse(unknown), null);
});

test('an adapter returns null when it cannot establish a meaningful label', () => {
  const radio = node('mat-radio-button', {
    name: 'mat-radio-group-2',
    role: 'radio'
  });

  assert.equal(registry.parse(radio), null);
});

test('registry uses the first adapter that successfully parses a node', () => {
  const calls = [];
  const first = { name: 'first', parse() { calls.push('first'); return null; } };
  const second = { name: 'second', parse() { calls.push('second'); return { ok: true }; } };
  const third = { name: 'third', parse() { calls.push('third'); return { ok: false }; } };

  const localRegistry = createAdapterRegistry([first, second, third]);
  assert.deepEqual(localRegistry.parse(node('div')), { ok: true });
  assert.deepEqual(calls, ['first', 'second']);
});
