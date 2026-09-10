import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverGroups } from '../src/preprocess/groupDiscovery.js';

function button(id, label, localContext, parentRegionLabel = 'Questionnaire') {
  return {
    id,
    entityId: 'entity:page',
    domId: id,
    name: '',
    label,
    type: 'button',
    rawType: 'button',
    role: '',
    tag: 'button',
    href: '',
    localContext,
    parentRegionLabel,
    parentRegionTag: 'section',
    regionPath: [parentRegionLabel],
    ownerFieldId: '',
    parentGroupId: null,
    required: false,
    disabled: false,
    visible: true,
    readonly: false,
    checked: null,
    defaultChecked: null,
    placeholder: '',
    value: '',
    defaultValue: '',
    valueDomain: [],
    attributes: {}
  };
}

test('separate local prompts keep repeated button choices in separate groups inside one broad region', () => {
  const q1 = 'First eligibility question';
  const q2 = 'Second eligibility question';
  const q3 = 'Third eligibility question';
  const fields = [
    button('q1-no', 'No', q1), button('q1-yes', 'Yes', q1),
    button('q2-no', 'No', q2), button('q2-yes', 'Yes', q2),
    button('q3-no', 'No', q3), button('q3-yes', 'Yes', q3)
  ];

  const groups = discoverGroups(fields, 'entity:page');
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => group.label).sort(), [q1, q2, q3].sort());
  for (const group of groups) assert.equal(group.memberFieldIds.length, 2);
});
