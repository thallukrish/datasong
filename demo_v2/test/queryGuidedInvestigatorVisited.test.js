import test from 'node:test';
import assert from 'node:assert/strict';
import { investigateQuery } from '../server/queryGuidedInvestigator.js';

function completion(payload) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
}

test('preferred OPEN gets one-hop preview while parked OPEN stays visible and selectable', async () => {
  const calls = [];
  const scripted = [
    completion({ intent: 'data_analytics', startKind: 'entity', entity: 'B', workflowId: '' }),
    completion({
      status: 'incomplete', missing: ['branch evidence'],
      retainFields: [{ entity: 'B', field: 'bField', purpose: 'join key' }], retainSteps: [], retainLinks: [],
      keepOpenEntities: ['B1', 'B2'], keepOpenWorkflowIds: [],
      expandEntities: ['B1'], expandWorkflowIds: []
    }),
    completion({
      status: 'incomplete', missing: ['parked branch evidence'],
      retainFields: [{ entity: 'B1', field: 'b1Field', purpose: 'branch one result' }], retainSteps: [], retainLinks: [],
      keepOpenEntities: ['B2'], keepOpenWorkflowIds: [],
      expandEntities: ['B3'], expandWorkflowIds: []
    }),
    completion({
      status: 'complete', intent: 'data_analytics', answer: 'Parked branch remained reachable.',
      retainFields: [], retainSteps: [], retainLinks: [],
      dataView: {
        grain: '',
        select: [
          { entity: 'B', field: 'bField', alias: 'b', role: 'key' },
          { entity: 'B1', field: 'b1Field', alias: 'b1', role: 'attribute' },
          { entity: 'B3', field: 'b3Field', alias: 'b3', role: 'attribute' }
        ],
        joins: [], filters: [], groupBy: [], orderBy: [], missing: []
      },
      nextStep: ''
    })
  ];
  const client = { chat: { completions: { create: async (request) => { calls.push(request); return scripted.shift(); } } } };

  const arcs = [{
    id: 'w1', title: 'Branching flow', businessIntent: 'Test persistent open traversal',
    entities: ['B', 'B1', 'B2', 'B3', 'Destination'], persistentObjects: ['B', 'B1', 'B2', 'B3', 'Destination'],
    entityDetails: [
      { name: 'B', description: 'Starting entity', fields: [{ name: 'bField', type: 'text' }, { name: 'unusedField', type: 'text' }] },
      { name: 'B1', description: 'First candidate', fields: [{ name: 'b1Field', type: 'text' }] },
      { name: 'B2', description: 'Second candidate', fields: [{ name: 'b2Field', type: 'text' }] },
      { name: 'B3', description: 'Initially parked candidate', fields: [{ name: 'b3Field', type: 'text' }] },
      { name: 'Destination', description: 'Useful destination behind B2', fields: [{ name: 'destinationField', type: 'text' }] }
    ],
    relationshipDetails: [
      { from: 'B', relation: 'linksToOne', to: 'B1', keyMaps: [{ fieldName: 'bField', relatedFieldName: 'b1Field' }], evidenced: true },
      { from: 'B', relation: 'linksToTwo', to: 'B2', keyMaps: [{ fieldName: 'bField', relatedFieldName: 'b2Field' }], evidenced: true },
      { from: 'B', relation: 'linksToThree', to: 'B3', keyMaps: [{ fieldName: 'bField', relatedFieldName: 'b3Field' }], evidenced: true },
      { from: 'B2', relation: 'leadsTo', to: 'Destination', keyMaps: [{ fieldName: 'b2Field', relatedFieldName: 'destinationField' }], evidenced: true }
    ],
    workflowSteps: []
  }];

  const result = await investigateQuery({
    question: 'test graph horizon and parked recovery', client, model: 'fake', arcs, snapshot: {}, mapStateForArc: () => 'complete'
  });

  const first = JSON.parse(calls[1].messages[1].content).context;
  const b2 = first.openEntities.find(x => x.name === 'B2');
  assert.ok(b2);
  assert.equal(b2.description, 'Second candidate');
  assert.ok(b2.connectsTo.some(x => x.entity === 'Destination'));
  assert.ok(b2.connectsTo.some(x => x.entity === 'B'));

  const second = JSON.parse(calls[2].messages[1].content).context;
  assert.equal(second.currentExpanded.entities[0].name, 'B1');
  assert.ok(second.openEntities.some(x => x.name === 'B2'));
  assert.ok(!second.openEntities.some(x => x.name === 'B3'));
  assert.ok(second.otherOpenEntityNames.includes('B3'));
  assert.equal(second.parkedOpenCounts.entities, 1);
  assert.ok(second.activeEvidence.fields.some(x => x.ref === 'B.bField'));
  assert.ok(!second.activeEvidence.fields.some(x => x.ref === 'B.unusedField'));
  assert.equal(second.observedEvidenceCounts.fields, 2);

  const third = JSON.parse(calls[3].messages[1].content).context;
  assert.equal(third.currentExpanded.entities[0].name, 'B3');
  assert.ok(third.activeEvidence.fields.some(x => x.ref === 'B.bField'));
  assert.ok(third.activeEvidence.fields.some(x => x.ref === 'B1.b1Field'));

  assert.equal(result.status, 'complete');
  assert.equal(result.investigation.expansionRounds, 2);
  assert.ok(result.investigation.exploredEvidenceCount >= 3);
  assert.equal(result.dataView.select[0].ref, 'B.bField');
  assert.equal(result.dataView.select[1].ref, 'B1.b1Field');
  assert.equal(result.dataView.select[2].ref, 'B3.b3Field');
});
