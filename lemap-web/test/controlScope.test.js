import test from 'node:test';
import assert from 'node:assert/strict';
import { controlScope, globalControlKeys } from '../src/agent/controlScope.js';

function entity(id, fields) {
  return { id, structure: { fields } };
}

const language = { id: 'field:language', label: 'English selected under language', type: 'select', groupId: '' };

test('a control recurring across distinct workflow entities is application-global', () => {
  const memory = { entities: {
    'entity:file-return': entity('entity:file-return', [language, { id: 'field:year', label: 'Assessment Year', type: 'select', groupId: '' }]),
    'entity:dashboard': entity('entity:dashboard', [language, { id: 'field:start', label: 'Start New Filing', type: 'button', groupId: '' }]),
    'entity:status': entity('entity:status', [language, { id: 'field:individual', label: 'Individual', type: 'radio', groupId: 'group:status' }])
  } };

  const keys = globalControlKeys(memory, { minDistinctEntities: 2 });
  assert.equal(keys.size, 1);
  assert.equal(controlScope(memory, language, 'entity:status'), 'application');
});

test('workflow-specific controls remain local', () => {
  const memory = { entities: {
    'entity:file-return': entity('entity:file-return', [language, { id: 'field:year', label: 'Assessment Year', type: 'select', groupId: '' }]),
    'entity:dashboard': entity('entity:dashboard', [language]),
    'entity:status': entity('entity:status', [language, { id: 'field:individual', label: 'Individual', type: 'radio', groupId: 'group:status' }])
  } };

  assert.equal(controlScope(memory, { id: 'field:individual', label: 'Individual', type: 'radio', groupId: 'group:status' }, 'entity:status'), 'entity');
});
