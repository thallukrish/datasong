import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSemanticPaths } from '../src/semantic/pathSelector.js';
import { buildPass1Prompt, normalizePass1Response } from '../src/semantic/pass1.js';
import { buildPass2Prompt, normalizePass2Response } from '../src/semantic/pass2.js';
import { materializeSemanticGraph } from '../src/semantic/semanticGraph.js';
import { learnSemanticPath } from '../src/semantic/semanticLearner.js';
import { buildLocalEntityPrompt, normalizeLocalEntityResponse, resolveLocalEntity } from '../src/semantic/localEntityResolver.js';
import { buildNavigationPrompt, normalizeNavigationResponse, scoreNavigationCandidates } from '../src/semantic/navigationScout.js';

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

const localEntity = {
  entity: { id: 'entity:filing', label: 'Please answer the following questions', presentation: { route: '/filing-status' } },
  fields: [
    { id: 'field:n', label: 'Taxable income is more than basic exemption limit', type: 'radio' },
    { id: 'field:y', label: 'Filing return due to Seventh Proviso conditions', type: 'radio' },
    { id: 'field:c1', label: 'Deposits exceed threshold', type: 'checkbox' }
  ],
  actions: [{ id: 'field:continue', label: 'Continue', type: 'button' }],
  groups: [{ id: 'group:reason', groupType: 'radio', memberFieldIds: ['field:n', 'field:y'] }]
};

const localObservations = [
  { id: 'obs:local:1', fieldId: 'field:y', action: { kind: 'select', value: 'Y' }, delta: { fieldsEnabled: ['field:c1'], actionsHidden: ['field:continue'] } },
  { id: 'obs:local:2', fieldId: 'field:c1', action: { kind: 'toggle', value: true }, delta: { actionsShown: ['field:continue'] } }
];

const localRelationships = [
  { kind: 'mutually_exclusive', groupType: 'radio', memberFieldIds: ['field:n', 'field:y'], evidenceIds: ['obs:local:1'] },
  { kind: 'enables_group', sourceFieldId: 'field:y', targetGroupId: 'group:conditions', memberFieldIds: ['field:c1'], evidenceIds: ['obs:local:1'] }
];

test('lightweight selector ranks bounded structural paths without code/repository concepts', () => {
  const paths = selectSemanticPaths(workflow, { limit: 4 });
  assert.ok(paths.length >= 1);
  assert.ok(paths[0].edgeIds.includes('edge:2'));
  assert.equal(JSON.stringify(paths).includes('function'), false);
  assert.equal(JSON.stringify(paths).includes('sourcePath'), false);
});

test('local entity semantic resolver receives deterministic fields, behavior and relationships', () => {
  const prompt = buildLocalEntityPrompt({ entityGraph: localEntity, observations: localObservations, learnedRelationships: localRelationships });
  assert.match(prompt, /web-local-entity-v1/);
  assert.match(prompt, /Seventh Proviso/);
  assert.match(prompt, /enables_group/);
  assert.doesNotMatch(prompt, /infer browser mechanics/i);

  const parsed = normalizeLocalEntityResponse({
    semanticName: 'Filing Reason', description: 'Determines why the taxpayer is filing the return.',
    fields: [{ structuralFieldId: 'field:y', semanticName: 'Seventh Proviso filing reason', description: 'Filing under qualifying conditions.' }],
    relationships: [{ kind: 'conditional_requirement', description: 'Qualifying conditions apply when this filing reason is selected.', evidenceIds: ['obs:local:1'] }],
    actions: [{ structuralFieldId: 'field:continue', semanticName: 'Complete filing reason', description: 'Advances after local requirements are satisfied.' }],
    localCompletion: 'A filing reason is selected and any activated qualifying conditions are satisfied.', confidence: 0.93
  });
  assert.equal(parsed.semanticName, 'Filing Reason');
  assert.equal(parsed.localCompletion.length > 0, true);
});

test('navigation scout scores outgoing candidates against original user goal and workflow context', () => {
  const semanticEntity = normalizeLocalEntityResponse({ semanticName: 'Filing Reason', description: 'Determines why the taxpayer is filing.', localCompletion: 'Valid filing reason established.', confidence: 0.9 });
  const candidates = [
    { id: 'action:continue', label: 'Continue', kind: 'action', href: '' },
    { id: 'link:dashboard', label: 'Dashboard', kind: 'link', href: '/dashboard' }
  ];
  const prompt = buildNavigationPrompt({ userGoal: 'I want to file ITR-3', semanticEntity, workflowContext: { title: 'File ITR-3', path: ['Filing Reason'] }, candidates });
  assert.match(prompt, /web-goal-navigation-v1/);
  assert.match(prompt, /I want to file ITR-3/);
  assert.match(prompt, /Continue/);
  assert.match(prompt, /Dashboard/);

  const parsed = normalizeNavigationResponse({ scores: [
    { candidateId: 'action:continue', goalRelevance: 0.95, continuity: 0.98, forwardProgress: 0.98, role: 'workflow_continuation', reason: 'Advances current filing setup.' },
    { candidateId: 'link:dashboard', goalRelevance: 0.01, continuity: 0.05, forwardProgress: 0.01, role: 'workflow_exit', reason: 'Leaves current filing workflow.' }
  ] }, candidates);
  assert.equal(parsed[0].candidateId, 'action:continue');
  assert.ok(parsed[0].goalRelevance > parsed[1].goalRelevance);
});

test('local resolver and goal-directed navigation scout execute through injected model client', async () => {
  const responses = [
    { semanticName: 'Filing Reason', description: 'Determines filing basis.', fields: [], relationships: [], actions: [], localCompletion: 'Valid filing basis established.', confidence: 0.9 },
    { scores: [
      { candidateId: 'continue', goalRelevance: 0.95, continuity: 0.99, forwardProgress: 0.98, role: 'workflow_continuation', reason: 'Forward action.' },
      { candidateId: 'dashboard', goalRelevance: 0.01, continuity: 0.04, forwardProgress: 0.01, role: 'workflow_exit', reason: 'Leaves context.' }
    ] }
  ];
  const requests = [];
  const client = { chat: { completions: { create: async (request) => {
    requests.push(request);
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(responses.shift()) } }] };
  } } } };

  const semanticEntity = await resolveLocalEntity({ client, model: 'test-model', entityGraph: localEntity, observations: localObservations, learnedRelationships: localRelationships });
  const scored = await scoreNavigationCandidates({ client, model: 'test-model', userGoal: 'I want to file ITR-3', semanticEntity, workflowContext: { title: 'File ITR-3' }, candidates: [
    { id: 'continue', label: 'Continue', kind: 'action' },
    { id: 'dashboard', label: 'Dashboard', kind: 'link', href: '/dashboard' }
  ] });
  assert.equal(requests.length, 2);
  assert.equal(semanticEntity.semanticName, 'Filing Reason');
  assert.equal(scored[0].candidateId, 'continue');
});

test('Pass 1 prompt and normalization operate on workflow/entity evidence', () => {
  const path = selectSemanticPaths(workflow, { limit: 1 })[0];
  const prompt = buildPass1Prompt({ workflowPath: path, workflowGraph: workflow, entities });
  assert.match(prompt, /STRUCTURAL WORKFLOW/);
  assert.match(prompt, /entity:filing/);
  assert.doesNotMatch(prompt, /repository search/i);

  const parsed = normalizePass1Response({ title: 'File ITR-3', businessActor: 'taxpayer', businessIntent: 'File an income-tax return', majorStages: ['Establish filing status', 'Capture personal information'], outcome: 'Return prepared', confidence: 0.9, evidenceIds: ['obs:1', 'obs:2'] });
  assert.equal(parsed.title, 'File ITR-3');
  assert.equal(parsed.evidenceIds.length, 2);
});

test('Pass 2 receives Pass-1 context plus whole structural entity/workflow evidence', () => {
  const path = selectSemanticPaths(workflow, { limit: 1 })[0];
  const pass1 = normalizePass1Response({ title: 'File ITR-3', businessActor: 'taxpayer', businessIntent: 'File return', majorStages: ['Filing status'], outcome: 'Prepared return', confidence: 0.8, evidenceIds: ['obs:1'] });
  const prompt = buildPass2Prompt({ pass1, workflowPath: path, workflowGraph: workflow, entities });
  assert.match(prompt, /WHOLE STRUCTURAL FLOW/);
  assert.match(prompt, /Filing reason/);

  const pass2 = normalizePass2Response({ entities: [{ structuralEntityId: 'entity:filing', semanticName: 'Filing Status', description: 'Captures why the return is being filed', evidenceIds: ['obs:1'] }], relationships: [], rules: [{ description: 'Qualifying conditions apply on one branch', evidenceIds: ['obs:1'] }], steps: [{ title: 'Establish filing status', entityIds: ['entity:filing'], evidenceIds: ['obs:1'] }], unresolvedBranches: [] });
  const graph = materializeSemanticGraph({ pass1, pass2 });
  assert.ok(graph.nodes.some((node) => node.type === 'workflow'));
  assert.ok(graph.nodes.some((node) => node.type === 'entity' && node.sourceEntityId === 'entity:filing'));
  assert.ok(graph.evidenceIds.includes('obs:1'));
});

test('semantic learner executes Pass 1 then whole-flow Pass 2 with an injected model client', async () => {
  const requests = [];
  const responses = [
    { title: 'File ITR-3', businessActor: 'taxpayer', businessIntent: 'File return', majorStages: ['Establish filing status', 'Capture details'], completionCondition: 'Return is ready', outcome: 'Prepared return', confidence: 0.9, evidenceIds: ['obs:1', 'obs:2'] },
    { entities: [{ structuralEntityId: 'entity:filing', semanticName: 'Filing Status', description: 'Captures filing status', evidenceIds: ['obs:1'] }], relationships: [], rules: [], steps: [{ title: 'Establish filing status', entityIds: ['entity:filing'], evidenceIds: ['obs:1'] }], unresolvedBranches: [], confidence: 0.9 }
  ];
  const client = { chat: { completions: { create: async (request) => {
    requests.push(request);
    const body = responses.shift();
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(body) } }], usage: { total_tokens: 10 } };
  } } } };

  const result = await learnSemanticPath({ client, model: 'test-model', workflowGraph: workflow, entities });
  assert.equal(requests.length, 2);
  assert.match(requests[0].messages[1].content, /web-pass1-v1/);
  assert.match(requests[1].messages[1].content, /web-pass2-whole-flow-v1/);
  assert.equal(result.pass1.title, 'File ITR-3');
  assert.ok(result.semanticGraph.nodes.some((node) => node.type === 'entity'));
  assert.ok(result.path.edgeIds.includes('edge:2'));
});
