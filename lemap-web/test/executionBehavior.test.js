import test from 'node:test';
import assert from 'node:assert/strict';
import { createSemanticMemory } from '../src/agent/memory.js';
import { classifyAndRecordExecutionBehavior } from '../src/agent/executionBehavior.js';

function delta(overrides = {}) {
  return {
    fieldValuesChanged: [], fieldsEnabled: [], fieldsDisabled: [], fieldsShown: [], fieldsHidden: [], fieldsAdded: [], fieldsRemoved: [],
    actionsEnabled: [], actionsDisabled: [], actionsShown: [], actionsHidden: [], regionsShown: [], regionsHidden: [],
    validationMessagesAdded: [], validationMessagesRemoved: [], optionsAdded: {}, optionsRemoved: {},
    routeChanged: false, entityChanged: false,
    ...overrides
  };
}

function memoryWithEntity() {
  const memory = createSemanticMemory('create shipment');
  memory.entities['entity:shipment'] = {
    id: 'entity:shipment',
    semantic: { semanticName: 'Shipment Setup', interactions: [] },
    executionBehaviors: {}
  };
  return memory;
}

test('execution behavior is novel once, then reused across values with the same external structural effect', () => {
  const memory = memoryWithEntity();

  const first = classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:shipment',
    semanticKey: 'delivery-region',
    sourceFieldIds: ['field:region'],
    delta: delta({
      fieldValuesChanged: [{ fieldId: 'field:region', before: '', after: 'West' }],
      fieldsEnabled: ['field:standard', 'field:express']
    })
  });

  assert.equal(first.novel, true);
  assert.equal(first.classId, 'behavior:delivery-region:1');

  const second = classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:shipment',
    semanticKey: 'delivery-region',
    sourceFieldIds: ['field:region'],
    delta: delta({
      fieldValuesChanged: [{ fieldId: 'field:region', before: '', after: 'East' }],
      fieldsEnabled: ['field:express', 'field:standard']
    })
  });

  assert.equal(second.novel, false);
  assert.equal(second.classId, first.classId);
  const stored = memory.entities['entity:shipment'].executionBehaviors['delivery-region'][0];
  assert.equal(stored.observations, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'observedValues'), false);
});

test('a different external structural effect creates a new behavior class', () => {
  const memory = memoryWithEntity();

  classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:shipment', semanticKey: 'delivery-region', sourceFieldIds: ['field:region'],
    delta: delta({ fieldsEnabled: ['field:standard', 'field:express'] })
  });

  const different = classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:shipment', semanticKey: 'delivery-region', sourceFieldIds: ['field:region'],
    delta: delta({ fieldsEnabled: ['field:standard', 'field:express'], fieldsShown: ['field:customs-details'] })
  });

  assert.equal(different.novel, true);
  assert.equal(different.classId, 'behavior:delivery-region:2');
  assert.equal(memory.entities['entity:shipment'].executionBehaviors['delivery-region'].length, 2);
});

test('same-effect-across-domain hypothesis stays consistent while executions share one class', () => {
  const memory = memoryWithEntity();
  const hypothesis = { mode: 'same_effect_across_domain', confidence: 0.92 };

  const first = classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:shipment', semanticKey: 'delivery-region', sourceFieldIds: ['field:region'],
    behaviorHypothesis: hypothesis,
    delta: delta({ fieldsEnabled: ['field:standard', 'field:express'] })
  });
  const second = classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:shipment', semanticKey: 'delivery-region', sourceFieldIds: ['field:region'],
    behaviorHypothesis: hypothesis,
    delta: delta({ fieldsEnabled: ['field:express', 'field:standard'] })
  });

  assert.equal(first.hypothesisStatus, 'consistent');
  assert.equal(second.hypothesisStatus, 'consistent');
});

test('new structural effect falsifies same-effect-across-domain hypothesis', () => {
  const memory = memoryWithEntity();
  const hypothesis = { mode: 'same_effect_across_domain', confidence: 0.95 };

  classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:shipment', semanticKey: 'delivery-region', sourceFieldIds: ['field:region'],
    behaviorHypothesis: hypothesis,
    delta: delta({ fieldsEnabled: ['field:standard', 'field:express'] })
  });
  const divergent = classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:shipment', semanticKey: 'delivery-region', sourceFieldIds: ['field:region'],
    behaviorHypothesis: hypothesis,
    delta: delta({ fieldsEnabled: ['field:standard', 'field:express'], regionsShown: ['region:customs'] })
  });

  assert.equal(divergent.novel, true);
  assert.equal(divergent.hypothesisStatus, 'falsified');
});
