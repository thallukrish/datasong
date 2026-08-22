import test from 'node:test';
import assert from 'node:assert/strict';
import { investigateQuery } from '../server/queryGuidedInvestigator.js';

function completion(payload) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
}

test('query-guided traversal visits only nodes actually expanded and blocks revisits', async () => {
  const calls = [];
  const scripted = [
    completion({ intent: 'data_analytics', startKind: 'entity', entity: 'B', workflowId: '' }),
    completion({
      status: 'incomplete', missing: ['next evidence'],
      retainFields: [{ entity: 'B', field: 'bField', purpose: 'useful evidence' }],
      retainSteps: [], retainLinks: [],
      expandEntities: ['B1'], expandWorkflowIds: []
    }),
    completion({
      status: 'incomplete', missing: ['more evidence'],
      retainFields: [{ entity: 'B1', field: 'b1Field', purpose: 'useful evidence' }],
      retainSteps: [], retainLinks: [],
      expandEntities: ['B'], expandWorkflowIds: []
    }),
    completion({
      status: 'complete', intent: 'data_analytics', answer: 'Traversal stopped without revisiting B.',
      retainFields: [], retainSteps: [], retainLinks: [],
      dataView: { grain: '', select: [], joins: [], filters: [], groupBy: [], orderBy: [], missing: ['more evidence'] },
      nextStep: ''
    })
  ];
  const client = { chat: { completions: { create: async (request) => { calls.push(request); return scripted.shift(); } } } };

  const arcs = [{
    id: 'w1', title: 'ABC flow', businessIntent: 'Test traversal',
    entities: ['A', 'B', 'C', 'B1'], persistentObjects: ['A', 'B', 'C', 'B1'],
    entityDetails: [
      { name: 'A', description: 'Untouched candidate A', fields: [{ name: 'aField', type: 'text' }] },
      { name: 'B', description: 'Chosen starting node B', fields: [{ name: 'bField', type: 'text' }] },
      { name: 'C', description: 'Untouched candidate C', fields: [{ name: 'cField', type: 'text' }] },
      { name: 'B1', description: 'Neighbour of B', fields: [{ name: 'b1Field', type: 'text' }] }
    ],
    relationshipDetails: [{ from: 'B', relation: 'linksTo', to: 'B1' }],
    workflowSteps: []
  }];

  const result = await investigateQuery({
    question: 'test B path', client, model: 'fake', arcs, snapshot: {}, mapStateForArc: () => 'complete'
  });

  const firstContext = JSON.parse(calls[1].messages[1].content).context;
  assert.equal(firstContext.currentExpanded.entities.length, 1);
  assert.equal(firstContext.currentExpanded.entities[0].name, 'B');
  assert.equal(firstContext.visited.length, 0);

  const secondContext = JSON.parse(calls[2].messages[1].content).context;
  assert.equal(secondContext.currentExpanded.entities.length, 1);
  assert.equal(secondContext.currentExpanded.entities[0].name, 'B1');
  assert.ok(secondContext.visited.some((node) => node.kind === 'entity' && node.name === 'B'));
  assert.ok(!secondContext.visited.some((node) => node.name === 'A'));
  assert.ok(!secondContext.visited.some((node) => node.name === 'C'));
  assert.ok(!secondContext.unselectedEntities.some((node) => node.name === 'B'));

  assert.equal(result.status, 'complete');
  assert.equal(result.investigation.expansionRounds, 1);
});
