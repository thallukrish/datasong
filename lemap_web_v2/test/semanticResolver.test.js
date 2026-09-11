import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityGraph } from '../src/graph/entityGraph.js';
import { enrichEntitySemantics } from '../src/semantic/semanticResolver.js';

function entity(id, name) {
  return {
    id,
    type: 'ui_control',
    name,
    structural: { controlType: 'text', tag: 'input', label: name },
    semantic: {},
    links: []
  };
}

test('enrichEntitySemantics asks the gateway to enrich only the requested entities', async () => {
  const graph = createEntityGraph({ entities: [
    entity('control:a', 'Income'),
    entity('control:b', 'Address')
  ] });
  const calls = [];
  const gateway = {
    run: async (request) => {
      calls.push(request);
      return {
        patches: [{ entityId: 'control:a', semantic: { purpose: 'collects income' } }]
      };
    }
  };

  await enrichEntitySemantics({ graph, gateway, entityIds: ['control:a'] });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'enrich_entities');
  assert.deepEqual(calls[0].entityIds, ['control:a']);
  assert.equal(graph.entities.find((item) => item.id === 'control:b').semantic.purpose, undefined);
});

test('enrichEntitySemantics merges model output into semantic fields only', async () => {
  const source = entity('control:a', 'Income');
  const graph = createEntityGraph({ entities: [source] });
  const gateway = {
    run: async () => ({
      patches: [{
        entityId: 'control:a',
        semantic: {
          purpose: 'collects income',
          businessConcept: 'taxable income'
        }
      }]
    })
  };

  const result = await enrichEntitySemantics({ graph, gateway, entityIds: ['control:a'] });
  const enriched = graph.entities.find((item) => item.id === 'control:a');

  assert.deepEqual(enriched.semantic, {
    purpose: 'collects income',
    businessConcept: 'taxable income'
  });
  assert.equal(enriched.structural.label, 'Income');
  assert.deepEqual(enriched.links, []);
  assert.deepEqual(result.updatedEntityIds, ['control:a']);
});

test('enrichEntitySemantics rejects patches for entities outside the requested scope', async () => {
  const graph = createEntityGraph({ entities: [
    entity('control:a', 'Income'),
    entity('control:b', 'Address')
  ] });
  const gateway = {
    run: async () => ({
      patches: [{ entityId: 'control:b', semantic: { purpose: 'unexpected' } }]
    })
  };

  await assert.rejects(() => enrichEntitySemantics({
    graph,
    gateway,
    entityIds: ['control:a']
  }), /requested scope/i);
});

test('enrichEntitySemantics rejects malformed semantic patches without changing the graph', async () => {
  const graph = createEntityGraph({ entities: [entity('control:a', 'Income')] });
  const gateway = {
    run: async () => ({
      patches: [{ entityId: 'control:a', structural: { label: 'Changed' } }]
    })
  };

  await assert.rejects(() => enrichEntitySemantics({
    graph,
    gateway,
    entityIds: ['control:a']
  }), /semantic/i);

  const current = graph.entities.find((item) => item.id === 'control:a');
  assert.equal(current.structural.label, 'Income');
  assert.deepEqual(current.semantic, {});
});

test('enrichEntitySemantics rejects unknown requested entity ids before invoking the model', async () => {
  const graph = createEntityGraph({ entities: [entity('control:a', 'Income')] });
  let called = false;
  const gateway = { run: async () => { called = true; return { patches: [] }; } };

  await assert.rejects(() => enrichEntitySemantics({
    graph,
    gateway,
    entityIds: ['control:missing']
  }), /unknown entity/i);
  assert.equal(called, false);
});
