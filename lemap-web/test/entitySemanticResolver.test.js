import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntitySemanticPrompt,
  buildNavigationSemanticPrompt,
  entitiesNeedingSemantics,
  normalizeEntitySemanticResponse,
  normalizeNavigationSemanticResponse,
  partitionSemanticCandidates,
  resolveEntitySemantics
} from '../src/semantic/entitySemanticResolver.js';

const workflow = { id: 'workflow:1', name: 'Complete setup', type: 'workflow', structural: { goal: 'Complete setup' }, semantic: {}, links: [{ id: 'page:1', relationship: 'contains' }] };
const pageEntities = [
  { id: 'page:1', name: 'Setup', type: 'page', structural: { route: '/setup' }, semantic: {}, links: [{ id: 'workflow:1', relationship: 'partOfWorkflow' }, { id: 'field:year', relationship: 'contains' }] },
  { id: 'field:year', name: 'Assessment Year', type: 'ui_control', structural: { controlType: 'select', values: ['2026-27', '2025-26'], disabled: false }, semantic: {}, links: [{ id: 'page:1', relationship: 'childOf' }] },
  { id: 'button:continue', name: 'Continue', type: 'ui_control', structural: { controlType: 'button', disabled: true }, semantic: {}, links: [{ id: 'page:1', relationship: 'childOf' }] }
];
const entities = [workflow, ...pageEntities];

test('semantic resolver prompt sends workflow, page and controls as ordinary entities', () => {
  const prompt = buildEntitySemanticPrompt({ userGoal: 'Complete setup', entities: pageEntities, pageId: 'page:1', knownWorkflow: workflow });
  assert.match(prompt, /web-entity-semantics-v1/);
  assert.match(prompt, /workflow:1/);
  assert.match(prompt, /field:year/);
  assert.match(prompt, /semantic additions only/i);
  assert.match(prompt, /omit irrelevant/i);
  assert.doesNotMatch(prompt, /workflow\?:/i);
});

test('semantic prompt sends only identity and minimal interpretation hints, not graph payload', () => {
  const manyValues = Array.from({ length: 20 }, (_, index) => `value-${index + 1}`);
  const manyLinks = Array.from({ length: 20 }, (_, index) => ({ id: `entity:${index + 1}`, relationship: 'contains' }));
  const prompt = buildEntitySemanticPrompt({
    userGoal: 'Choose a value',
    entities: [{
      id: 'field:large',
      name: 'Large Choice',
      type: 'ui_control',
      structural: { controlType: 'select', values: manyValues, visible: true, disabled: false, required: true },
      semantic: {},
      links: manyLinks
    }]
  });

  assert.match(prompt, /"id":"field:large"/);
  assert.match(prompt, /"name":"Large Choice"/);
  assert.match(prompt, /"type":"ui_control"/);
  assert.match(prompt, /"controlType":"select"/);
  assert.doesNotMatch(prompt, /optionCount|optionSample|value-1|linkCount|entity:1/);
});

test('only entities without completed semantics are selected for model enrichment', () => {
  const resolvedInput = {
    ...pageEntities[1],
    semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which assessment year?', meaning: 'assessment year' }
  };
  const unresolvedAction = {
    ...pageEntities[2],
    structural: { ...pageEntities[2].structural, disabled: false },
    semantic: { interaction: 'navigation', relevantToGoal: true, workflowRole: 'continue' }
  };
  const resolvedWorkflow = {
    ...workflow,
    semantic: { relevantToGoal: true, complete: false, description: 'Complete setup' }
  };

  const selected = entitiesNeedingSemantics([resolvedWorkflow, resolvedInput, unresolvedAction]);
  assert.deepEqual(selected.map((entity) => entity.id), ['button:continue']);
});

test('semantic candidates split actionable navigation from user-input interpretation', () => {
  const group = { id: 'group:mode', name: 'Mode', type: 'group', structural: { cardinality: 'exactlyOne', values: ['A', 'B'] }, semantic: {}, links: [] };
  const textInput = { id: 'field:name', name: 'Name', type: 'ui_control', structural: { controlType: 'text' }, semantic: {}, links: [] };
  const link = { id: 'link:help', name: 'Help', type: 'ui_control', structural: { controlType: 'link' }, semantic: {}, links: [] };
  const button = { id: 'button:next', name: 'Continue', type: 'ui_control', structural: { controlType: 'button' }, semantic: {}, links: [] };
  const split = partitionSemanticCandidates([workflow, pageEntities[0], group, textInput, link, button]);
  assert.deepEqual(split.navigation.map((entity) => entity.id), ['link:help', 'button:next']);
  assert.deepEqual(split.entity.map((entity) => entity.id), ['workflow:1', 'page:1', 'group:mode', 'field:name']);
});

test('navigation semantic prompt contains only compact action identity plus page and goal context', () => {
  const prompt = buildNavigationSemanticPrompt({
    userGoal: 'Complete setup',
    pageContext: pageEntities[0],
    entities: [pageEntities[2], { id: 'link:help', name: 'Help', type: 'ui_control', structural: { controlType: 'link', visible: true }, links: [{ id: 'page:1', relationship: 'childOf' }] }]
  });
  assert.match(prompt, /MODE web-navigation-semantics-v1/);
  assert.match(prompt, /"name":"Setup"/);
  assert.match(prompt, /"name":"Continue"/);
  assert.match(prompt, /"name":"Help"/);
  assert.match(prompt, /workflowRole/);
  assert.match(prompt, /navigationPriority/);
  assert.doesNotMatch(prompt, /links|visible|question|explanation|caveats|selectionRule/);
});

test('navigation response keeps only navigation fields', () => {
  const result = normalizeNavigationSemanticResponse({
    entities: [{
      id: 'button:continue',
      semantic: {
        interaction: 'navigation', relevantToGoal: true, required: true,
        workflowRole: 'continue', navigationPriority: 93, consequence: 'reversible',
        explanation: 'unwanted verbosity', question: 'also unwanted', caveats: ['unwanted']
      }
    }]
  }, [pageEntities[2]]);
  assert.deepEqual(result.entities[0], {
    id: 'button:continue',
    semantic: {
      interaction: 'navigation', relevantToGoal: true, required: true,
      workflowRole: 'continue', navigationPriority: 93, consequence: 'reversible'
    }
  });
});

test('grouped radio members are structural choices, not separate semantic entities', () => {
  const group = {
    id: 'group:mode',
    name: 'Filing Mode',
    type: 'group',
    structural: { groupType: 'radio', cardinality: 'exactlyOne', values: ['Online (Recommended)', 'Offline'] },
    semantic: {},
    links: [
      { id: 'field:online', relationship: 'contains' },
      { id: 'field:offline', relationship: 'contains' }
    ]
  };
  const online = {
    id: 'field:online',
    name: 'Online (Recommended)',
    type: 'ui_control',
    structural: { controlType: 'radio' },
    semantic: {},
    links: [{ id: 'group:mode', relationship: 'partOf' }]
  };
  const offline = {
    id: 'field:offline',
    name: 'Offline',
    type: 'ui_control',
    structural: { controlType: 'radio' },
    semantic: {},
    links: [{ id: 'group:mode', relationship: 'partOf' }]
  };

  const selected = entitiesNeedingSemantics([group, online, offline]);
  assert.deepEqual(selected.map((entity) => entity.id), ['group:mode']);

  const prompt = buildEntitySemanticPrompt({ userGoal: 'File a return', entities: selected });
  assert.match(prompt, /group:mode/);
  assert.match(prompt, /"cardinality":"exactlyOne"/);
  assert.match(prompt, /Online \(Recommended\)/);
  assert.match(prompt, /Offline/);
  assert.doesNotMatch(prompt, /field:online|field:offline/);
});

test('semantic response can refine a group selection rule', () => {
  const group = { id: 'group:conditions', name: 'Applicable Conditions', type: 'group', structural: { groupType: 'checkbox', cardinality: 'zeroOrMore' }, semantic: {}, links: [] };
  const result = normalizeEntitySemanticResponse({
    entities: [{ id: 'group:conditions', semantic: { interaction: 'user_input', relevantToGoal: true, required: true, selectionRule: 'atLeastOne', question: 'Which conditions apply?' } }]
  }, [group]);
  assert.equal(result.entities[0].semantic.selectionRule, 'atLeastOne');
});

test('semantic response accepts workflow completion as a normal semantic patch', () => {
  const result = normalizeEntitySemanticResponse({
    entities: [
      { id: 'workflow:1', semantic: { meaning: 'complete setup', description: 'Move through setup.', complete: false, relevantToGoal: true } },
      { id: 'field:year', semantic: { meaning: 'assessment year', scope: 'local', interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which year?', explanation: 'Choose the year.', caveats: ['Use the applicable year.'], examples: ['2026-27'] } },
      { id: 'button:continue', semantic: { interaction: 'navigation', workflowRole: 'continue', consequence: 'reversible', relevantToGoal: true } },
      { id: 'made-up', semantic: { meaning: 'invented' } }
    ]
  }, entities);

  assert.equal(result.entities.length, 3);
  const workflowPatch = result.entities.find((item) => item.id === 'workflow:1');
  assert.equal(workflowPatch.semantic.complete, false);
  assert.equal(workflowPatch.semantic.description, 'Move through setup.');
  assert.equal(result.entities.find((item) => item.id === 'button:continue').semantic.consequence, 'reversible');
});

test('navigation semantics preserve page-relative role and clamp priority', () => {
  const result = normalizeEntitySemanticResponse({
    entities: [
      { id: 'button:continue', semantic: { interaction: 'navigation', workflowRole: 'branch', navigationPriority: 117, consequence: 'reversible', relevantToGoal: true } },
      { id: 'field:year', semantic: { interaction: 'navigation', workflowRole: 'exit', navigationPriority: -8, consequence: 'reversible', relevantToGoal: false } }
    ]
  }, entities);
  assert.equal(result.entities[0].semantic.workflowRole, 'branch');
  assert.equal(result.entities[0].semantic.navigationPriority, 100);
  assert.equal(result.entities[1].semantic.workflowRole, 'exit');
  assert.equal(result.entities[1].semantic.navigationPriority, 0);
});

test('navigation prompt asks model to rank actions relative to active workflow', () => {
  const prompt = buildNavigationSemanticPrompt({ userGoal: 'Complete setup', entities: [pageEntities[2]], pageContext: pageEntities[0] });
  assert.match(prompt, /navigationPriority/i);
  assert.match(prompt, /continue\|back\|branch\|global\|exit/i);
  assert.match(prompt, /web-navigation-semantics-v1/i);
});

test('semantic resolver dispatches general and navigation entities to separate model calls', async () => {
  const sentPrompts = [];
  const client = { chat: { completions: { create: async ({ messages }) => {
    const prompt = messages[1].content;
    sentPrompts.push(prompt);
    const navigation = /MODE web-navigation-semantics-v1/.test(prompt);
    return {
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(navigation
        ? { entities: [{ id: 'button:continue', semantic: { interaction: 'navigation', workflowRole: 'continue', navigationPriority: 95, consequence: 'reversible', relevantToGoal: true } }] }
        : { entities: [{ id: 'workflow:1', semantic: { description: 'Move through setup.', complete: false, relevantToGoal: true } }] }
      ) } }],
      usage: { total_tokens: 10 }
    };
  } } } };

  const executableEntities = pageEntities.map((entity) => entity.id === 'button:continue'
    ? { ...entity, structural: { ...entity.structural, disabled: false } }
    : entity);
  const result = await resolveEntitySemantics({ client, model: 'test-model', userGoal: 'Complete setup', entities: executableEntities, pageId: 'page:1', knownWorkflow: workflow, pageContext: pageEntities[0] });
  assert.equal(sentPrompts.length, 2);
  assert.match(sentPrompts[0], /MODE web-entity-semantics-v1/);
  assert.match(sentPrompts[0], /workflow:1/);
  assert.doesNotMatch(sentPrompts[0], /button:continue/);
  assert.match(sentPrompts[1], /MODE web-navigation-semantics-v1/);
  assert.match(sentPrompts[1], /button:continue/);
  assert.doesNotMatch(sentPrompts[1], /field:year/);
  assert.equal(result.entities.find((item) => item.id === 'workflow:1').semantic.complete, false);
  assert.equal(result.entities.find((item) => item.id === 'button:continue').semantic.consequence, 'reversible');
  assert.equal(result.entities.find((item) => item.id === 'button:continue').semantic.navigationPriority, 95);
});
