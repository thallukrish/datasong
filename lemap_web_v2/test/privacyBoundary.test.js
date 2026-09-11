import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeEntityForModel,
  buildModelPayload,
  assertModelSafe
} from '../src/semantic/privacyBoundary.js';

function entity(overrides = {}) {
  return {
    id: 'control:income',
    type: 'ui_control',
    name: 'Gross income',
    structural: {
      controlType: 'text',
      tag: 'input',
      domId: 'income',
      name: 'income',
      label: 'Gross income',
      path: [0, 2],
      ...overrides.structural
    },
    semantic: {
      purpose: 'collects gross income',
      ...overrides.semantic
    },
    links: overrides.links || []
  };
}

test('sanitizeEntityForModel preserves structural and semantic knowledge but removes runtime-value fields', () => {
  const source = entity({
    structural: {
      value: '1250',
      checked: true,
      selectedValue: '2026'
    },
    semantic: {
      userValue: 'secret',
      explanation: 'Annual gross income field'
    },
    links: [{
      id: 'section:reason',
      relationship: 'dynamicChild',
      condition: { value: 'N' },
      reference: { kind: 'local-file', id: 'file:7' }
    }]
  });

  const safe = sanitizeEntityForModel(source);

  assert.equal(safe.id, 'control:income');
  assert.equal(safe.structural.label, 'Gross income');
  assert.equal(safe.semantic.explanation, 'Annual gross income field');
  assert.equal('value' in safe.structural, false);
  assert.equal('checked' in safe.structural, false);
  assert.equal('selectedValue' in safe.structural, false);
  assert.equal('userValue' in safe.semantic, false);
  assert.deepEqual(safe.links, [{ id: 'section:reason', relationship: 'dynamicChild', condition: {} }]);
});

test('buildModelPayload never includes the instance graph or its values', () => {
  const entityGraph = {
    version: 1,
    entities: [entity()]
  };
  const instanceGraph = {
    version: 1,
    instances: [{
      entityId: 'control:income',
      value: '1250',
      reference: { kind: 'local-file', id: 'file:7' }
    }]
  };

  const payload = buildModelPayload({ entityGraph, instanceGraph });
  const serialized = JSON.stringify(payload);

  assert.deepEqual(payload.graph.version, 1);
  assert.equal(payload.graph.entities.length, 1);
  assert.equal('instances' in payload, false);
  assert.equal(serialized.includes('1250'), false);
  assert.equal(serialized.includes('file:7'), false);
});

test('buildModelPayload does not mutate the persistent entity graph while sanitizing', () => {
  const source = entity({ structural: { value: '1250' } });
  const entityGraph = { version: 1, entities: [source] };

  buildModelPayload({ entityGraph });

  assert.equal(source.structural.value, '1250');
});

test('assertModelSafe rejects payloads that still contain runtime-value fields at any depth', () => {
  assert.throws(() => assertModelSafe({
    graph: {
      entities: [{
        id: 'control:income',
        structural: { label: 'Income' },
        nested: { runtimeValue: '1250' }
      }]
    }
  }), /runtime/i);

  assert.throws(() => assertModelSafe({
    graph: {
      entities: [{
        id: 'control:file',
        semantic: { reference: { kind: 'local-file', id: 'file:7' } }
      }]
    }
  }), /runtime/i);
});

test('assertModelSafe accepts sanitized structural and semantic context', () => {
  const payload = buildModelPayload({
    entityGraph: {
      version: 1,
      entities: [entity({
        links: [{ id: 'page:2', relationship: 'transitionsTo' }]
      })]
    }
  });

  assert.doesNotThrow(() => assertModelSafe(payload));
});
