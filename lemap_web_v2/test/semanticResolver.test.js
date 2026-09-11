import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityGraph } from '../src/graph/entityGraph.js';
import { enrichEntitySemantics, chooseNavigationCandidate } from '../src/semantic/semanticResolver.js';

function entity(id, name, semantic = {}, structural = {}) {
  return { id, type: 'ui_control', name, structural: { controlType: 'text', tag: 'input', label: name, ...structural }, semantic, links: [] };
}

test('enrichEntitySemantics sends only unresolved requested entities in compact form', async () => {
  const graph = createEntityGraph({ entities: [
    entity('a', 'Income'),
    entity('b', 'Address', { meaning: 'Postal address', interaction: 'user_input', relevantToGoal: true, required: true, question: 'Address?' })
  ] });
  const calls = [];
  const gateway = { run: async (request) => { calls.push(request); return { entities: [{ id: 'a', semantic: { meaning: 'Income field', interaction: 'user_input', relevantToGoal: true, required: true, question: 'Income?' } }] }; } };

  await enrichEntitySemantics({ graph, gateway, entityIds: ['a', 'b'], query: 'File return', workflowPages: [{ id: 'p1', name: 'Dashboard' }], currentPage: { id: 'p2', name: 'Return' } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'enrich_entities');
  assert.deepEqual(calls[0].payload.entities.map((item) => item.id), ['a']);
  assert.equal('graph' in calls[0], false);
});

test('enrichEntitySemantics only merges whitelisted semantic fields', async () => {
  const graph = createEntityGraph({ entities: [entity('a', 'Income')] });
  const gateway = { run: async () => ({ entities: [{ id: 'a', structural: { label: 'Other' }, semantic: { meaning: 'Income field', interaction: 'user_input', relevantToGoal: true, required: true, question: 'Income?', extraField: 'ignored' } }] }) };
  const result = await enrichEntitySemantics({ graph, gateway, entityIds: ['a'] });
  const enriched = graph.entities.find((item) => item.id === 'a');

  assert.equal(enriched.structural.label, 'Income');
  assert.equal(enriched.semantic.meaning, 'Income field');
  assert.equal(enriched.semantic.extraField, undefined);
  assert.deepEqual(result.updatedEntityIds, ['a']);
});

test('enrichEntitySemantics ignores model entities outside requested scope', async () => {
  const graph = createEntityGraph({ entities: [entity('a', 'Income'), entity('b', 'Address')] });
  const gateway = { run: async () => ({ entities: [{ id: 'b', semantic: { meaning: 'Unexpected' } }] }) };
  const result = await enrichEntitySemantics({ graph, gateway, entityIds: ['a'] });
  assert.deepEqual(result.updatedEntityIds, []);
  assert.deepEqual(graph.entities.find((item) => item.id === 'b').semantic, {});
});

test('enrichEntitySemantics rejects unknown requested ids before model call', async () => {
  const graph = createEntityGraph({ entities: [entity('a', 'Income')] });
  let called = false;
  const gateway = { run: async () => { called = true; return { entities: [] }; } };
  await assert.rejects(() => enrichEntitySemantics({ graph, gateway, entityIds: ['missing'] }), /unknown entity/i);
  assert.equal(called, false);
});

test('chooseNavigationCandidate uses a separate compact model call', async () => {
  const calls = [];
  const gateway = { run: async (request) => { calls.push(request); return { selectedEntityId: 'next' }; } };
  const selected = await chooseNavigationCandidate({ gateway, query: 'File return', workflowPages: [{ id: 'p1', name: 'Dashboard' }], currentPage: { id: 'p2', name: 'Return' }, candidates: [entity('back', 'Back', {}, { controlType: 'button' }), entity('next', 'Continue', {}, { controlType: 'button' })] });
  assert.equal(selected.id, 'next');
  assert.equal(calls[0].operation, 'choose_navigation');
  assert.deepEqual(calls[0].payload.candidates, [{ id: 'back', label: 'Back', controlType: 'button' }, { id: 'next', label: 'Continue', controlType: 'button' }]);
});
