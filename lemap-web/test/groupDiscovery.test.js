import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverGroups } from '../src/preprocess/groupDiscovery.js';

function field(id, type, label, context, extra = {}) {
  return {
    id,
    type,
    label,
    name: '',
    parentRegionLabel: context,
    value: extra.value ?? null,
    ...extra
  };
}

test('radio peers become one exactly-one choice group', () => {
  const fields = [
    field('r1', 'radio', 'Individual', 'Which status applies?', { name: 'status', value: 'individual' }),
    field('r2', 'radio', 'HUF', 'Which status applies?', { name: 'status', value: 'huf' })
  ];
  const groups = discoverGroups(fields, 'entity:page');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupType, 'choice');
  assert.equal(groups[0].cardinality, 'exactlyOne');
  assert.equal(groups[0].label, 'Which status applies?');
  assert.deepEqual(groups[0].memberFieldIds, ['r1', 'r2']);
});

test('checkbox peers become one zero-or-more choice group', () => {
  const fields = [
    field('c1', 'checkbox', 'Salary', 'Which incomes apply?'),
    field('c2', 'checkbox', 'Business', 'Which incomes apply?')
  ];
  const groups = discoverGroups(fields, 'entity:page');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupType, 'choice');
  assert.equal(groups[0].cardinality, 'zeroOrMore');
});

test('yes/no answer buttons become one exactly-one choice group', () => {
  const fields = [
    field('b1', 'button', 'Yes', 'Are you a director?'),
    field('b2', 'button', 'No', 'Are you a director?')
  ];
  const groups = discoverGroups(fields, 'entity:page');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupType, 'choice');
  assert.equal(groups[0].cardinality, 'exactlyOne');
});

test('multi-option answer buttons become one exactly-one choice group', () => {
  const fields = [
    field('b1', 'button', 'ROR', 'What is your residential status?'),
    field('b2', 'button', 'NOR', 'What is your residential status?'),
    field('b3', 'button', 'NR', 'What is your residential status?'),
    field('b4', 'button', "Don't Know", 'What is your residential status?')
  ];
  const groups = discoverGroups(fields, 'entity:page');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].cardinality, 'exactlyOne');
});

test('navigation/action buttons are not grouped as a user choice', () => {
  const fields = [
    field('b1', 'button', 'Back', 'Filing controls'),
    field('b2', 'button', 'Continue', 'Filing controls'),
    field('b3', 'button', 'Submit', 'Filing controls')
  ];
  assert.deepEqual(discoverGroups(fields, 'entity:page'), []);
});
