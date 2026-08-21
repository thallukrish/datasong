import test from 'node:test';
import assert from 'node:assert/strict';
import { investigateQuery } from '../server/queryInvestigator.js';

function toolCall(id, name, args = {}) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

test('query investigator lets model navigate map and finalizes bounded evidence', async () => {
  const scripted = [
    { choices: [{ message: { content: null, tool_calls: [toolCall('t1', 'list_workflows', { limit: 10 }), toolCall('t2', 'list_entities', { limit: 20 })] } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    { choices: [{ message: { content: null, tool_calls: [toolCall('t3', 'get_workflow', { id: 'w1' }), toolCall('t4', 'get_entity_fields', { name: 'OrderItem' }), toolCall('t5', 'finalize_investigation')] } }], usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } },
    { choices: [{ message: { content: JSON.stringify({ intent: 'data_analytics', answer: 'Use order items as the fact grain.', workflowsUsed: [], relevantEntities: ['OrderItem'], relevantRelationships: [], candidateView: { purpose: 'sales by product', factGrain: 'one order item', entities: ['OrderItem'], joins: [], dimensions: [], measures: ['quantity'], filters: [], missing: [] }, scenarios: [], missingEvidence: [], nextStep: '' }) } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }
  ];
  const client = { chat: { completions: { create: async () => scripted.shift() } } };
  const arcs = [{
    id: 'w1', title: 'Place order', businessIntent: 'Customer places an order', closureState: 'closed',
    entities: ['OrderItem', 'Product'], persistentObjects: ['OrderItem'],
    workflowSteps: [{ name: 'Create order item', description: 'Adds the selected product', entities: ['OrderItem', 'Product'] }],
    entityDetails: [{ name: 'OrderItem', description: 'Purchased product line', schemaResolved: true, fields: [{ name: 'quantity', type: 'decimal', description: 'Quantity purchased', authoritative: true }] }],
    relationshipDetails: [{ from: 'OrderItem', relation: 'references', to: 'Product', description: 'Identifies the purchased product' }]
  }];

  const result = await investigateQuery({
    question: 'highest selling products by region', client, model: 'fake', arcs, snapshot: {},
    mapStateForArc: () => 'complete', pathHints: () => []
  });

  assert.equal(result.intent, 'data_analytics');
  assert.equal(result.investigation.status, 'finalized');
  assert.ok(result.investigation.toolCalls <= 10);
  assert.ok(result.investigation.breadthCalls <= 2);
  assert.match(result.answer, /order items/i);
});
