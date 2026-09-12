import test from 'node:test';
import assert from 'node:assert/strict';
import { runApplication } from '../src/app/applicationRunner.js';
import { createContextStack, createFrame } from '../src/orchestrator/contextStack.js';

function makeState() {
  const pageId = 'page:a';
  const frame = createFrame({ kind: 'page', contextEntityId: pageId, pageEntityId: pageId, visibleEntityIds: [] });
  return {
    entityGraph: { version: 1, entities: [] },
    instanceGraph: { version: 1, instances: [] },
    workflow: { id: 'wf:1', originalQuestion: 'q', steps: [] },
    contextStack: createContextStack(frame)
  };
}

test('runtime diagnostics log counts and only a small candidate sample', async () => {
  const state = makeState();
  const frame = state.contextStack.frames[0];
  const candidates = Array.from({ length: 25 }, (_, index) => ({
    id: `control:${index}`,
    type: 'ui_control',
    name: `Choice ${index}`,
    structural: { controlType: 'button' },
    semantic: {},
    links: []
  }));
  state.entityGraph.entities.push(...candidates);
  frame.visibleEntityIds = candidates.map((candidate) => candidate.id);

  const events = [];
  const result = await runApplication({
    state,
    page: {},
    query: 'q',
    gateway: {},
    logger: { log: async (type, data) => events.push({ type, data }) },
    maxSteps: 1,
    deps: {
      enrichEntitySemantics: async () => ({ updatedEntityIds: candidates.map((candidate) => candidate.id), called: true }),
      selectReusableInput: () => null,
      selectNextRequiredInput: () => null,
      selectNavigationCandidates: () => candidates,
      chooseNavigationCandidate: async () => null
    }
  });

  assert.equal(result.reason, 'blocked');

  const semantic = events.find((event) => event.type === 'semantic.enrichment');
  assert.equal(semantic.data.entityCount, 25);
  assert.equal(semantic.data.updatedCount, 25);
  assert.equal('selectedEntityIds' in semantic.data, false);

  const navigation = events.find((event) => event.type === 'navigation.candidates');
  assert.equal(navigation.data.entityCount, 25);
  assert.equal(navigation.data.selectedEntityIds.length, 8);
  assert.deepEqual(navigation.data.selectedEntityIds, candidates.slice(0, 8).map((candidate) => candidate.id));
});
