import test from 'node:test';
import assert from 'node:assert/strict';
import { investigateQuery } from '../server/queryGuidedInvestigator.js';

function completion(payload) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
}

test('query-guided traversal preserves discovered OPEN siblings across hops and keeps durable qualified evidence', async () => {
  const calls = [];
  const scripted = [
    completion({ intent: 'data_analytics', startKind: 'entity', entity: 'B', workflowId: '' }),
    completion({
      status: 'incomplete', missing: ['branch one evidence'],
      retainFields: [], retainSteps: [], retainLinks: [],
      expandEntities: ['B1'], expandWorkflowIds: []
    }),
    completion({
      status: 'incomplete', missing: ['branch two evidence'],
      retainFields: [], retainSteps: [], retainLinks: [],
      expandEntities: ['B2'], expandWorkflowIds: []
    }),
    completion({
      status: 'complete', intent: 'data_analytics', answer: 'Evidence from both branches is available.',
      retainFields: [], retainSteps: [], retainLinks: [],
      dataView: {
        grain: '',
        select: [
          { entity: 'B', field: 'bField', alias: 'b', role: 'key' },
          { entity: 'B1', field: 'b1Field', alias: 'b1', role: 'attribute' },
          { entity: 'B2', field: 'b2Field', alias: 'b2', role: 'attribute' }
        ],
        joins: [], filters: [], groupBy: [], orderBy: [], missing: []
      },
      nextStep: ''
    })
  ];
  const client = { chat: { completions: { create: async (request) => { calls.push(request); return scripted.shift(); } } } };

  const arcs = [{
    id: 'w1', title: 'Branching flow', businessIntent: 'Test persistent open traversal',
    entities: ['A', 'B', 'C', 'B1', 'B2'], persistentObjects: ['A', 'B', 'C', 'B1', 'B2'],
    entityDetails: [
      { name: 'A', description: 'Untouched candidate A', fields: [{ name: 'aField', type: 'text' }] },
      { name: 'B', description: 'Chosen starting node B', fields: [{ name: 'bField', type: 'text' }] },
      { name: 'C', description: 'Untouched candidate C', fields: [{ name: 'cField', type: 'text' }] },
      { name: 'B1', description: 'First neighbour of B', fields: [{ name: 'b1Field', type: 'text' }] },
      { name: 'B2', description: 'Second neighbour of B', fields: [{ name: 'b2Field', type: 'text' }] }
    ],
    relationshipDetails: [
      { from: 'B', relation: 'linksToOne', to: 'B1', keyMaps: [{ fieldName: 'bField', relatedFieldName: 'b1Field' }], evidenced: true },
      { from: 'B', relation: 'linksToTwo', to: 'B2', keyMaps: [{ fieldName: 'bField', relatedFieldName: 'b2Field' }], evidenced: true }
    ],
    workflowSteps: []
  }];

  const result = await investigateQuery({
    question: 'test both B branches', client, model: 'fake', arcs, snapshot: {}, mapStateForArc: () => 'complete'
  });

  const firstContext = JSON.parse(calls[1].messages[1].content).context;
  assert.equal(firstContext.currentExpanded.entities.length, 1);
  assert.equal(firstContext.currentExpanded.entities[0].name, 'B');
  assert.equal(firstContext.visited.length, 0);
  assert.ok(firstContext.openEntities.some((node) => node.name === 'B1'));
  assert.ok(firstContext.openEntities.some((node) => node.name === 'B2'));

  const secondContext = JSON.parse(calls[2].messages[1].content).context;
  assert.equal(secondContext.currentExpanded.entities.length, 1);
  assert.equal(secondContext.currentExpanded.entities[0].name, 'B1');
  assert.ok(secondContext.visited.some((node) => node.kind === 'entity' && node.name === 'B'));
  assert.ok(secondContext.openEntities.some((node) => node.name === 'B2'));
  assert.ok(!secondContext.openEntities.some((node) => node.name === 'B'));
  assert.ok(secondContext.exploredEvidence.fields.some((field) => field.ref === 'B.bField'));
  assert.equal(secondContext.selectedEvidence.fields.length, 0);

  const thirdContext = JSON.parse(calls[3].messages[1].content).context;
  assert.equal(thirdContext.currentExpanded.entities.length, 1);
  assert.equal(thirdContext.currentExpanded.entities[0].name, 'B2');
  assert.ok(thirdContext.visited.some((node) => node.name === 'B'));
  assert.ok(thirdContext.visited.some((node) => node.name === 'B1'));
  assert.ok(!thirdContext.visited.some((node) => node.name === 'A'));
  assert.ok(!thirdContext.visited.some((node) => node.name === 'C'));
  assert.ok(thirdContext.exploredEvidence.fields.some((field) => field.ref === 'B.bField'));
  assert.ok(thirdContext.exploredEvidence.fields.some((field) => field.ref === 'B1.b1Field'));

  assert.equal(result.status, 'complete');
  assert.equal(result.investigation.expansionRounds, 2);
  assert.ok(result.investigation.exploredEvidenceCount >= 2);
  assert.equal(result.dataView.select[0].ref, 'B.bField');
  assert.equal(result.dataView.select[1].ref, 'B1.b1Field');
  assert.equal(result.dataView.select[2].ref, 'B2.b2Field');
});
