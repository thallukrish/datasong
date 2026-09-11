import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelGateway } from '../src/semantic/modelGateway.js';

function graphWithRuntimeNoise() {
  return {
    version: 1,
    entities: [{
      id: 'control:income',
      type: 'ui_control',
      name: 'Gross income',
      structural: {
        controlType: 'text',
        label: 'Gross income',
        value: '1250'
      },
      semantic: {
        purpose: 'collects gross income'
      },
      links: []
    }]
  };
}

test('createModelGateway routes model calls through the privacy boundary', async () => {
  const calls = [];
  const gateway = createModelGateway({
    invoke: async (request) => {
      calls.push(request);
      return { ok: true };
    }
  });

  const result = await gateway.run({
    entityGraph: graphWithRuntimeNoise(),
    instanceGraph: {
      version: 1,
      instances: [{ entityId: 'control:income', value: '1250' }]
    },
    operation: 'enrich_entities',
    entityIds: ['control:income']
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'enrich_entities');
  assert.deepEqual(calls[0].entityIds, ['control:income']);
  assert.equal('instances' in calls[0], false);
  assert.equal(JSON.stringify(calls[0]).includes('1250'), false);
  assert.equal(calls[0].graph.entities[0].structural.label, 'Gross income');
});

test('model gateway never forwards the instance graph object to the provider', async () => {
  let received;
  const gateway = createModelGateway({
    invoke: async (request) => {
      received = request;
      return {};
    }
  });

  await gateway.run({
    entityGraph: { version: 1, entities: [] },
    instanceGraph: {
      version: 1,
      instances: [{ entityId: 'control:x', reference: { kind: 'local-file', id: 'file:7' } }]
    },
    operation: 'describe_page'
  });

  const serialized = JSON.stringify(received);
  assert.equal(serialized.includes('file:7'), false);
  assert.equal('instanceGraph' in received, false);
});

test('model gateway accepts only structural entity ids as optional targeting context', async () => {
  let received;
  const gateway = createModelGateway({
    invoke: async (request) => {
      received = request;
      return {};
    }
  });

  await gateway.run({
    entityGraph: { version: 1, entities: [] },
    operation: 'enrich_entities',
    entityIds: ['entity:a', 'entity:a', 'entity:b']
  });

  assert.deepEqual(received.entityIds, ['entity:a', 'entity:b']);
});

test('createModelGateway rejects missing provider invocation function', () => {
  assert.throws(() => createModelGateway(), /invoke/i);
  assert.throws(() => createModelGateway({ invoke: 'not-a-function' }), /invoke/i);
});

test('model gateway rejects malformed requests before calling the provider', async () => {
  let calls = 0;
  const gateway = createModelGateway({
    invoke: async () => {
      calls += 1;
      return {};
    }
  });

  await assert.rejects(() => gateway.run({
    entityGraph: { version: 1, entities: [] },
    operation: ''
  }), /operation/i);

  await assert.rejects(() => gateway.run({
    entityGraph: { version: 1, entities: [] },
    operation: 'describe_page',
    entityIds: 'entity:a'
  }), /entityIds/i);

  assert.equal(calls, 0);
});
