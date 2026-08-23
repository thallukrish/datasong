import test from 'node:test';
import assert from 'node:assert/strict';
import { investigateQuery } from '../server/queryGuidedInvestigator.js';

function completion(payload) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
}

test('model keeps useful OPEN nodes and retained fields while LeMap parks the rest without forgetting them', async () => {
  const calls = [];
  const scripted = [
    completion({ intent: 'data_analytics', startKind: 'entity', entity: 'B', workflowId: '' }),
    completion({
      status: 'incomplete', missing: ['branch one evidence'],
      retainFields: [{ entity: 'B', field: 'bField', purpose: 'join key' }], retainSteps: [], retainLinks: [],
      keepOpenEntities: ['B1', 'B2'], keepOpenWorkflowIds: [],
      expandEntities: ['B1'], expandWorkflowIds: []
    }),
    completion({
      status: 'incomplete', missing: ['branch two evidence'],
      retainFields: [{ entity: 'B1', field: 'b1Field', purpose: 'branch one result' }], retainSteps: [], retainLinks: [],
      keepOpenEntities: ['B2'], keepOpenWorkflowIds: [],
      expandEntities: ['B2'], expandWorkflowIds: []
    }),
    completion({
      status: 'complete', intent: 'data_analytics', answer: 'Evidence from both active branches is available.',
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
    entities: ['B', 'B1', 'B2', 'B3'], persistentObjects: ['B', 'B1', 'B2', 'B3'],
    entityDetails: [
      { name: 'B', fields: [{ name: 'bField', type: 'text' }, { name: 'unusedField', type: 'text' }] },
      { name: 'B1', fields: [{ name: 'b1Field', type: 'text' }] },
      { name: 'B2', fields: [{ name: 'b2Field', type: 'text' }] },
      { name: 'B3', fields: [{ name: 'b3Field', type: 'text' }] }
    ],
    relationshipDetails: [
      { from: 'B', relation: 'linksToOne', to: 'B1', keyMaps: [{ fieldName: 'bField', relatedFieldName: 'b1Field' }], evidenced: true },
      { from: 'B', relation: 'linksToTwo', to: 'B2', keyMaps: [{ fieldName: 'bField', relatedFieldName: 'b2Field' }], evidenced: true },
      { from: 'B', relation: 'irrelevantBranch', to: 'B3', keyMaps: [{ fieldName: 'bField', relatedFieldName: 'b3Field' }], evidenced: true }
    ],
    workflowSteps: []
  }];

  const result = await investigateQuery({
    question: 'test both useful B branches', client, model: 'fake', arcs, snapshot: {}, mapStateForArc: () => 'complete'
  });

  const first = JSON.parse(calls[1].messages[1].content).context;
  assert.ok(first.openEntities.some(x => x.name === 'B1'));
  assert.ok(first.openEntities.some(x => x.name === 'B2'));
  assert.ok(first.openEntities.some(x => x.name === 'B3'));
  assert.equal(first.currentExpanded.entities[0].fields.length, 2);

  const second = JSON.parse(calls[2].messages[1].content).context;
  assert.equal(second.currentExpanded.entities[0].name, 'B1');
  assert.ok(second.openEntities.some(x => x.name === 'B2'));
  assert.ok(!second.openEntities.some(x => x.name === 'B3'));
  assert.equal(second.parkedOpenCounts.entities, 1);
  assert.ok(second.activeEvidence.fields.some(x => x.ref === 'B.bField'));
  assert.ok(!second.activeEvidence.fields.some(x => x.ref === 'B.unusedField'));
  assert.equal(second.observedEvidenceCounts.fields, 2);

  const third = JSON.parse(calls[3].messages[1].content).context;
  assert.equal(third.currentExpanded.entities[0].name, 'B2');
  assert.ok(third.activeEvidence.fields.some(x => x.ref === 'B.bField'));
  assert.ok(third.activeEvidence.fields.some(x => x.ref === 'B1.b1Field'));
  assert.equal(third.parkedOpenCounts.entities, 1);

  assert.equal(result.status, 'complete');
  assert.equal(result.investigation.expansionRounds, 2);
  assert.equal(result.investigation.parkedEntityCount, 1);
  assert.ok(result.investigation.exploredEvidenceCount >= 3);
  assert.equal(result.dataView.select[0].ref, 'B.bField');
  assert.equal(result.dataView.select[1].ref, 'B1.b1Field');
  assert.equal(result.dataView.select[2].ref, 'B2.b2Field');
});
