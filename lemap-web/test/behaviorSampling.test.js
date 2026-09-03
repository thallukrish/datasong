import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseBehaviorSamples,
  normalizeExternalEffect,
  clusterBehaviorEffects
} from '../src/explore/behaviorSampling.js';

test('small finite domains are explored exhaustively', () => {
  const options = Array.from({ length: 6 }, (_, index) => ({ value: `v${index + 1}`, label: `Option ${index + 1}` }));
  const result = chooseBehaviorSamples(options, { maxSamples: 10, seedKey: 'entity:x/field:y' });
  assert.equal(result.coverage.domainSize, 6);
  assert.equal(result.coverage.probedCount, 6);
  assert.equal(result.coverage.exhaustive, true);
  assert.equal(result.coverage.samplingMethod, 'exhaustive');
  assert.deepEqual(result.samples, options);
});

test('large finite domains use bounded reproducible sampling', () => {
  const options = Array.from({ length: 50 }, (_, index) => ({ value: `v${index + 1}`, label: `Option ${index + 1}` }));
  const first = chooseBehaviorSamples(options, { maxSamples: 10, seedKey: 'entity:x/field:y' });
  const second = chooseBehaviorSamples(options, { maxSamples: 10, seedKey: 'entity:x/field:y' });
  assert.equal(first.coverage.domainSize, 50);
  assert.equal(first.coverage.probedCount, 10);
  assert.equal(first.coverage.exhaustive, false);
  assert.equal(first.coverage.samplingMethod, 'seeded_random');
  assert.deepEqual(first.samples, second.samples);
  assert.equal(new Set(first.samples.map((item) => item.value)).size, 10);
});

test('external effect normalization removes the probed control own value noise', () => {
  const normalized = normalizeExternalEffect({
    fieldValuesChanged: [
      { fieldId: 'field:source', before: '', after: '2026-27' },
      { fieldId: 'field:other', before: '', after: 'ready' }
    ],
    fieldsEnabled: ['field:source', 'field:other'],
    fieldsDisabled: [], fieldsShown: [], fieldsHidden: [], fieldsAdded: [], fieldsRemoved: [],
    actionsEnabled: ['action:continue'], actionsDisabled: [], actionsShown: [], actionsHidden: [],
    regionsShown: [], regionsHidden: [], validationMessagesAdded: [], validationMessagesRemoved: [],
    optionsAdded: { 'field:source': ['x'], 'field:other': ['y'] }, optionsRemoved: {},
    routeChanged: false, entityChanged: false
  }, { sourceFieldId: 'field:source' });

  assert.deepEqual(normalized.fieldValuesChanged, [{ fieldId: 'field:other', before: '', after: 'ready' }]);
  assert.deepEqual(normalized.fieldsEnabled, ['field:other']);
  assert.deepEqual(normalized.optionsAdded, { 'field:other': ['y'] });
  assert.deepEqual(normalized.actionsEnabled, ['action:continue']);
});

test('identical external effects collapse into a single behavior class with coverage', () => {
  const coverage = { domainSize: 25, probedCount: 10, exhaustive: false, samplingMethod: 'seeded_random' };
  const effect = { fieldsEnabled: ['field:mode'], actionsDisabled: ['action:continue'] };
  const probes = Array.from({ length: 10 }, (_, index) => ({
    sample: { value: `v${index + 1}`, label: `Value ${index + 1}` },
    effect
  }));
  const result = clusterBehaviorEffects(probes, { coverage });
  assert.equal(result.classes.length, 1);
  assert.equal(result.classes[0].sampleCount, 10);
  assert.equal(result.classes[0].wildcard, false);
  assert.deepEqual(result.coverage, coverage);
  assert.equal(result.exhaustiveWildcard, false);
});

test('one exhaustively proven effect class may be abstracted as wildcard', () => {
  const coverage = { domainSize: 3, probedCount: 3, exhaustive: true, samplingMethod: 'exhaustive' };
  const probes = ['a', 'b', 'c'].map((value) => ({ sample: { value, label: value }, effect: { actionsEnabled: ['continue'] } }));
  const result = clusterBehaviorEffects(probes, { coverage });
  assert.equal(result.classes.length, 1);
  assert.equal(result.classes[0].wildcard, true);
  assert.equal(result.exhaustiveWildcard, true);
});
