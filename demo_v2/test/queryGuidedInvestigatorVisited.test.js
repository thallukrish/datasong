import test from 'node:test';
import assert from 'node:assert/strict';
import { investigateQuery } from '../server/queryGuidedInvestigator.js';

function completion(payload) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
}

test('query-guided traversal exposes visited neighbours as context but never as expandable frontier', async () => {
  const calls = [];
  const scripted = [
    completion({ intent: 'data_analytics', workflowIds: [], entities: ['OrderItem', 'Order'] }),
    completion({
      status: 'incomplete',
      missing: ['region'],
      retainFields: [{ entity: 'OrderItem', field: 'quantity', purpose: 'sales volume' }],
      retainSteps: [],
      retainLinks: [],
      expandEntities: ['OrderPart'],
      expandWorkflowIds: []
    }),
    completion({
      status: 'incomplete',
      missing: ['more order context'],
      retainFields: [{ entity: 'OrderPart', field: 'region', purpose: 'region dimension' }],
      retainSteps: [],
      retainLinks: [],
      expandEntities: ['Order'],
      expandWorkflowIds: []
    }),
    completion({
      status: 'complete',
      intent: 'data_analytics',
      answer: 'Use order item quantity grouped by order-part region.',
      retainFields: [], retainSteps: [], retainLinks: [],
      dataView: { grain: 'order item', select: [], joins: [], filters: [], groupBy: [], orderBy: [], missing: [] },
      nextStep: ''
    })
  ];
  const client = {
    chat: { completions: { create: async (request) => { calls.push(request); return scripted.shift(); } } }
  };

  const arcs = [{
    id: 'w1', title: 'Order flow', businessIntent: 'Place and fulfill an order',
    entities: ['Order', 'OrderItem', 'OrderPart'], persistentObjects: ['OrderItem', 'OrderPart'],
    entityDetails: [
      { name: 'Order', description: 'Order aggregate', fields: [] },
      { name: 'OrderItem', description: 'Purchased product line', fields: [{ name: 'quantity', type: 'decimal' }] },
      { name: 'OrderPart', description: 'Order shipping part', fields: [{ name: 'region', type: 'text' }] }
    ],
    relationshipDetails: [
      { from: 'Order', relation: 'contains', to: 'OrderItem' },
      { from: 'Order', relation: 'contains', to: 'OrderPart' }
    ],
    workflowSteps: []
  }];

  const result = await investigateQuery({
    question: 'highest selling products by region',
    client,
    model: 'fake',
    arcs,
    snapshot: {},
    mapStateForArc: () => 'complete'
  });

  const secondAnswerPayload = JSON.parse(calls[2].messages[1].content);
  const context = secondAnswerPayload.context;

  assert.ok(context.visitedNodes.some((node) => node.kind === 'entity' && node.name === 'Order'));
  assert.ok(context.visitedLinkedEntities.some((node) => node.name === 'Order' && node.state === 'visited'));
  assert.ok(!context.unselectedEntities.some((node) => node.name === 'Order'));
  assert.equal(result.status, 'complete');
  assert.equal(result.investigation.expansionRounds, 1);
});
