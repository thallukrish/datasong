import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPageStructure, buildWebFlow, diffState } from '../src/structuralFlow.js';
import { WebFlowIndexer } from '../src/webFlowIndexer.js';

const pageDom = {
  tag: 'main', label: 'General Information', children: [
    { tag: 'section', label: 'Personal Details', children: [] },
    { tag: 'section', label: 'Filing Status', children: [
      { tag: 'label', label: 'Tax Regime', children: [
        { tag: 'input', type: 'radio', name: 'taxRegime', value: 'old' },
        { tag: 'input', type: 'radio', name: 'taxRegime', value: 'new' }
      ]},
      { tag: 'div', label: 'Form 10-IEA', hidden: true, children: [] }
    ]}
  ]
};

test('buildPageStructure preserves labelled DOM hierarchy and interactive controls', () => {
  const page = buildPageStructure(pageDom);
  assert.equal(page.label, 'General Information');
  assert.equal(page.sections[1].label, 'Filing Status');
  assert.equal(page.sections[1].regions[0].label, 'Tax Regime');
  assert.deepEqual(page.sections[1].regions[0].controls.map(c => c.value), ['old', 'new']);
  assert.equal(page.sections[1].regions[1].hidden, true);
});

test('diffState reports only meaningful labelled state changes', () => {
  const before = { page: 'General Information', values: { taxRegime: null }, regions: { 'Form 10-IEA': { visible: false } } };
  const after = { page: 'General Information', values: { taxRegime: 'new' }, regions: { 'Form 10-IEA': { visible: true } } };
  assert.deepEqual(diffState(before, after), [
    { kind: 'value', key: 'taxRegime', before: null, after: 'new' },
    { kind: 'region', key: 'Form 10-IEA', before: { visible: false }, after: { visible: true } }
  ]);
});

test('buildWebFlow connects source control, trigger, execution evidence and resulting state delta', () => {
  const flow = buildWebFlow({
    id: 'tax-regime-new',
    sourceState: { page: 'General Information', values: { taxRegime: null }, regions: { 'Form 10-IEA': { visible: false } } },
    sourceRegion: 'Filing Status',
    sourceControl: 'Tax Regime',
    trigger: { kind: 'SELECT', value: 'new' },
    execution: [
      { kind: 'function', name: 'onTaxRegimeChange' },
      { kind: 'network', method: 'POST', url: '/filing-status' },
      { kind: 'function', name: 'applyFilingStatus' }
    ],
    resultState: { page: 'General Information', values: { taxRegime: 'new' }, regions: { 'Form 10-IEA': { visible: true } } }
  });
  assert.equal(flow.source.region, 'Filing Status');
  assert.equal(flow.trigger.kind, 'SELECT');
  assert.deepEqual(flow.effects.map(e => e.key), ['taxRegime', 'Form 10-IEA']);
  assert.ok(flow.normalizedFlowTokens.includes('network:POST:/filing-status'));
});

test('WebFlowIndexer removes duplicates and contained prefixes while keeping the maximal flow', () => {
  const index = new WebFlowIndexer();
  index.addPath({ id: 'a', tokens: ['page:A', 'trigger:x', 'state:B'] });
  index.addPath({ id: 'a-dup', tokens: ['page:A', 'trigger:x', 'state:B'] });
  index.addPath({ id: 'b', tokens: ['page:A', 'trigger:x', 'state:B', 'trigger:y', 'state:C'] });
  const ranked = index.rank();
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'b');
  assert.equal(ranked[0].duplicateCount, 1);
  assert.deepEqual(ranked[0].containedPathIds.sort(), ['a', 'a-dup'].sort());
});

test('WebFlowIndexer groups branch variants and ranks longer meaningful flows first', () => {
  const index = new WebFlowIndexer();
  index.addPath({ id: 'old', tokens: ['page:General', 'section:Filing', 'trigger:regime', 'state:old'] });
  index.addPath({ id: 'new', tokens: ['page:General', 'section:Filing', 'trigger:regime', 'state:new', 'section:Form10IEA'] });
  index.addPath({ id: 'bank', tokens: ['page:General', 'section:Bank', 'trigger:save', 'state:saved'] });
  const ranked = index.rank();
  assert.equal(ranked[0].id, 'new');
  assert.ok(ranked[0].branchVariants.some(v => v.id === 'old'));
  assert.ok(ranked.some(p => p.id === 'bank'));
});
