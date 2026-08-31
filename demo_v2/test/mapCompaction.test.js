import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPersistedMap } from '../server/explorer/compactMapFormat.js';

const noisy = {
  version: 3,
  repoUrl: 'https://github.com/example/repo',
  commit: 'abc123',
  savedAt: '2026-08-31T00:00:00.000Z',
  graph: [
    {
      id: 'entity:Order', type: 'entity', name: 'Order',
      data: { schemaResolved: true, description: 'Order', evidence: [{ huge: 'debug-payload' }] },
      links: [{ nodeId: 'field:Order.id', relationship: 'has field', confidence: 1, evidence: [{ huge: 'link-debug' }], data: {} }]
    },
    { id: 'field:Order.id', type: 'field', name: 'Order.id', data: { fieldName: 'id', dataType: 'id', evidence: [{ huge: 'field-debug' }] }, links: [] }
  ],
  learningProgress: {
    incompleteArcs: [{
      id: 'arc-9', title: 'Place order', businessActor: 'customer', businessIntent: 'place order',
      progress: 0, status: 'forming', closureState: '', callPathId: 'callpath:9', callPathVariantIds: ['callpath:10'],
      businessPriority: 0.8, priorityClass: 'revenue_critical',
      evidence: [{ huge: 'arc-history' }], entityDetails: [{ huge: 'duplicated-schema' }],
      relationshipDetails: [{ huge: 'duplicated-relations' }], workflowSteps: [{ huge: 'uninterpreted-runtime' }],
      pass2Checkpoint: { huge: 'runtime-checkpoint' }
    }],
    scheduler: { activeArcId: 'arc-9', nextArcNumber: 10 },
    scout: { reviewedCallPathIds: ['callpath:1'], exhausted: false }
  }
};

test('compaction preserves semantic graph structure and resume identity while dropping historical baggage', () => {
  const compact = compactPersistedMap(noisy);
  assert.equal(compact.version, 3);
  assert.equal(compact.format, 'compact-v1');
  assert.equal(compact.repoUrl, noisy.repoUrl);
  assert.equal(compact.graph.length, 2);
  assert.equal(compact.graph[0].data.description, 'Order');
  assert.equal(compact.graph[0].data.evidence, undefined);
  assert.equal(compact.graph[0].links[0].evidence, undefined);

  const pending = compact.learningProgress.incompleteArcs[0];
  assert.equal(pending.id, 'arc-9');
  assert.equal(pending.callPathId, 'callpath:9');
  assert.deepEqual(pending.callPathVariantIds, ['callpath:10']);
  assert.equal(pending.businessPriority, 0.8);
  assert.equal(pending.evidence, undefined);
  assert.equal(pending.entityDetails, undefined);
  assert.equal(pending.relationshipDetails, undefined);
  assert.equal(pending.pass2Checkpoint, undefined);
});
