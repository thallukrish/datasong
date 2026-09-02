import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePage, summarizeBrowserEvent, summarizeNetworkEvent } from '../src/browserCapture.js';

test('choosePage prefers the last normal http page and ignores devtools pages', () => {
  const pages = [
    { url: () => 'chrome://newtab/' },
    { url: () => 'https://example.com/a' },
    { url: () => 'https://example.com/itr3' }
  ];
  assert.equal(choosePage(pages).url(), 'https://example.com/itr3');
});

test('summarizeBrowserEvent keeps user-facing event evidence only', () => {
  assert.deepEqual(summarizeBrowserEvent({ type: 'change', tag: 'INPUT', label: 'Tax Regime', name: 'taxRegime', value: 'new' }), {
    kind: 'event', name: 'change', tag: 'input', label: 'Tax Regime', controlName: 'taxRegime', value: 'new'
  });
});

test('summarizeNetworkEvent normalizes request and response evidence', () => {
  assert.deepEqual(summarizeNetworkEvent({ phase: 'response', method: 'POST', url: 'https://site/api/status', status: 200 }), {
    kind: 'network', phase: 'response', method: 'POST', url: 'https://site/api/status', status: 200
  });
});
