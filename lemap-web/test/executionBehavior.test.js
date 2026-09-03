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

test('execution behavior is novel once, then reused across values with the same external structural effect', () => {
  const memory = createSemanticMemory('file ITR-3');
  memory.entities['entity:return'] = {
    id: 'entity:return',
    semantic: { semanticName: 'Income Tax Return Filing', interactions: [] },
    executionBehaviors: {}
  };

  const first = classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:return',
    semanticKey: 'assessment_year',
    sourceFieldIds: ['field:year'],
    delta: delta({
      fieldValuesChanged: [{ fieldId: 'field:year', before: '', after: '2026-27' }],
      fieldsEnabled: ['field:online', 'field:offline']
    })
  });

  assert.equal(first.novel, true);
  assert.equal(first.classId, 'behavior:assessment_year:1');

  const second = classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:return',
    semanticKey: 'assessment_year',
    sourceFieldIds: ['field:year'],
    delta: delta({
      fieldValuesChanged: [{ fieldId: 'field:year', before: '', after: '2025-26' }],
      fieldsEnabled: ['field:offline', 'field:online']
    })
  });

  assert.equal(second.novel, false);
  assert.equal(second.classId, first.classId);
  const stored = memory.entities['entity:return'].executionBehaviors.assessment_year[0];
  assert.equal(stored.observations, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'observedValues'), false);
});

test('a different external structural effect creates a new behavior class', () => {
  const memory = createSemanticMemory('file ITR-3');
  memory.entities['entity:return'] = { id: 'entity:return', semantic: { semanticName: 'Income Tax Return Filing', interactions: [] }, executionBehaviors: {} };

  classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:return', semanticKey: 'assessment_year', sourceFieldIds: ['field:year'],
    delta: delta({ fieldsEnabled: ['field:online', 'field:offline'] })
  });

  const different = classifyAndRecordExecutionBehavior(memory, {
    entityId: 'entity:return', semanticKey: 'assessment_year', sourceFieldIds: ['field:year'],
    delta: delta({ fieldsEnabled: ['field:online', 'field:offline'], fieldsShown: ['field:legacy-declaration'] })
  });

  assert.equal(different.novel, true);
  assert.equal(different.classId, 'behavior:assessment_year:2');
  assert.equal(memory.entities['entity:return'].executionBehaviors.assessment_year.length, 2);
});
