import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSemanticPaths } from '../src/semantic/pathSelector.js';
import { buildPass1Prompt, normalizePass1Response } from '../src/semantic/pass1.js';
import { buildPass2Prompt, normalizePass2Response } from '../src/semantic/pass2.js';
import { materializeSemanticGraph } from '../src/semantic/semanticGraph.js';

const workflow = {
  id: 'workflow:itr3',
  nodes: new Set(['entity:filing', 'entity:personal', 'entity:income']),
  edges: [
    { id: 'edge:1', sourceEntityId: 'entity:filing', targetEntityId: 'entity:filing', actionId: 'reason-y', kind: 'inline_expand', branchCondition: 'reason=Y', evidenceIds: ['obs:1'] },
    { id: 'edge:2', sourceEntityId: 'entity:filing', targetEntityId: 'entity:personal', actionId: 'continue', kind: 'navigation', branchCondition: 'valid', evidenceIds: ['obs:2'] },
    { id: 'edge:3', sourceEntityId: 'entity:personal', targetEntityId: 'entity:income', actionId: 'continue', kind: 'navigation', branchCondition: '', evidenceIds: ['obs:3'] }
  ]
};

const entities = {
  'entity:filing': { id: 'entity:filing', label: 'Filing Status', fields: [{ id: 'field:reason', label: 'Filing reason', type: 'radio' }] },
  'entity:personal': { id: 'entity:personal', label: 'Personal Information', fields: [] },
  'entity:income': { id: 'entity:income', label: 'Income Details', fields: [] }
};

test('lightweight selector ranks bounded structural paths without code/repository concepts', () => {
  const paths = selectSemanticPaths(workflow, { limit: 4 });
  assert.ok(paths.length >= 1);
  assert.ok(paths[0].edgeIds.includes('edge:2'));
  assert.equal(JSON.stringify(paths).includes('function'), false);
  assert.equal(JSON.stringify(paths).includes('sourcePath'), false);
});

test('Pass 1 prompt and normalization operate on workflow/entity evidence', () => {
  const path = selectSemanticPaths(workflow, { limit: 1 })[0];
  const prompt = buildPass1Prompt({ workflowPath: path, workflowGraph: workflow, entities });
  assert.match(prompt, /STRUCTURAL WORKFLOW/);
  assert.match(prompt, /entity:filing/);
  assert.doesNotMatch(prompt, /repository search/i);

  const parsed = normalizePass1Response({
    title: 'File ITR-3', businessActor: 'taxpayer', businessIntent: 'File an income-tax return',
    majorStages: ['Establish filing status', 'Capture personal information'], outcome: 'Return prepared', confidence: 0.9,
    evidenceIds: ['obs:1', 'obs:2']
  });
  assert.equal(parsed.title, 'File ITR-3');
  assert.equal(parsed.evidenceIds.length, 2);
});

test('Pass 2 receives Pass-1 context plus whole structural entity/workflow evidence', () => {
  const path = selectSemanticPaths(workflow, { limit: 1 })[0];
  const pass1 = normalizePass1Response({ title: 'File ITR-3', businessActor: 'taxpayer', businessIntent: 'File return', majorStages: ['Filing status'], outcome: 'Prepared return', confidence: 0.8, evidenceIds: ['obs:1'] });
  const prompt = buildPass2Prompt({ pass1, workflowPath: path, workflowGraph: workflow, entities });
  assert.match(prompt, /WHOLE STRUCTURAL FLOW/);
  assert.match(prompt, /Filing reason/);

  const pass2 = normalizePass2Response({
    entities: [{ structuralEntityId: 'entity:filing', semanticName: 'Filing Status', description: 'Captures why the return is being filed', evidenceIds: ['obs:1'] }],
    relationships: [], rules: [{ description: 'Qualifying conditions apply on one branch', evidenceIds: ['obs:1'] }],
    steps: [{ title: 'Establish filing status', entityIds: ['entity:filing'], evidenceIds: ['obs:1'] }], unresolvedBranches: []
  });
  const graph = materializeSemanticGraph({ pass1, pass2 });
  assert.ok(graph.nodes.some((node) => node.type === 'workflow'));
  assert.ok(graph.nodes.some((node) => node.type === 'entity' && node.sourceEntityId === 'entity:filing'));
  assert.ok(graph.evidenceIds.includes('obs:1'));
});
