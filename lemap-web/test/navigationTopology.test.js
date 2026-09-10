import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNavigationTopology } from '../src/agent/navigationTopology.js';

function page(id, name, route, url = `https://example.test${route}`) {
  return { id, name, type: 'page', structural: { route, url }, semantic: {}, links: [] };
}

function control(id, pageId, name, { href = '', controlType = 'link', transitionsTo = '' } = {}) {
  return {
    id,
    name,
    type: 'ui_control',
    structural: { controlType, href, visible: true, disabled: false },
    semantic: {},
    links: [
      { id: pageId, relationship: 'childOf' },
      ...(transitionsTo ? [{ id: transitionsTo, relationship: 'transitionsTo' }] : [])
    ]
  };
}

test('known transition to an earlier workflow page is deterministically back and excluded from model selection', () => {
  const p1 = page('page:one', 'One', '/one');
  const p2 = page('page:two', 'Two', '/two');
  const back = control('field:back', p2.id, 'Edit one', { transitionsTo: p1.id });
  const forward = control('field:forward', p2.id, 'Candidate', { controlType: 'button' });
  const graph = [p1, p2, back, forward];

  const result = resolveNavigationTopology({
    entityGraph: graph,
    currentEntities: [p2, back, forward],
    currentPageId: p2.id,
    recentPageTrail: [{ id: p1.id, name: p1.name }, { id: p2.id, name: p2.name }]
  });

  assert.equal(result.deterministicPatches.find((patch) => patch.id === back.id)?.semantic.workflowRole, 'back');
  assert.deepEqual(result.modelCandidates.map((entity) => entity.id), [forward.id]);
});

test('known unique transition to a page outside the past trail is deterministic forward progress', () => {
  const p1 = page('page:one', 'One', '/one');
  const p2 = page('page:two', 'Two', '/two');
  const p3 = page('page:three', 'Three', '/three');
  const learnedForward = control('field:forward', p2.id, 'Arbitrary label', { controlType: 'button', transitionsTo: p3.id });
  const unresolved = control('field:other', p2.id, 'Other candidate', { controlType: 'button' });

  const result = resolveNavigationTopology({
    entityGraph: [p1, p2, p3, learnedForward, unresolved],
    currentEntities: [p2, learnedForward, unresolved],
    currentPageId: p2.id,
    recentPageTrail: [{ id: p1.id, name: p1.name }, { id: p2.id, name: p2.name }]
  });

  const patch = result.deterministicPatches.find((item) => item.id === learnedForward.id);
  assert.equal(patch?.semantic.workflowRole, 'continue');
  assert.equal(patch?.semantic.navigationPriority, 100);
  assert.deepEqual(result.modelCandidates.map((entity) => entity.id), [unresolved.id]);
});

test('href that uniquely resolves to an earlier page route is back before the link has been executed', () => {
  const p1 = page('page:status', 'Status', '/app#/status', 'https://example.test/app#/status');
  const p2 = page('page:form', 'Form', '/app#/form', 'https://example.test/app#/form');
  const status = control('field:status', p2.id, 'Earlier step', { href: '#/status' });

  const result = resolveNavigationTopology({
    entityGraph: [p1, p2, status],
    currentEntities: [p2, status],
    currentPageId: p2.id,
    recentPageTrail: [{ id: p1.id, name: p1.name }, { id: p2.id, name: p2.name }]
  });

  assert.equal(result.deterministicPatches[0]?.semantic.workflowRole, 'back');
  assert.equal(result.deterministicPatches[0]?.semantic.navigationPriority, 0);
  assert.deepEqual(result.modelCandidates, []);
});

test('same-route SPA states stay unresolved unless a learned transition identifies the target page', () => {
  const route = '/app#/wizard';
  const p1 = page('page:state-one', 'Wizard State One', route, 'https://example.test/app#/wizard');
  const p2 = page('page:state-two', 'Wizard State Two', route, 'https://example.test/app#/wizard');
  const ambiguous = control('field:ambiguous', p2.id, 'Earlier state', { href: '#/wizard' });

  const result = resolveNavigationTopology({
    entityGraph: [p1, p2, ambiguous],
    currentEntities: [p2, ambiguous],
    currentPageId: p2.id,
    recentPageTrail: [{ id: p1.id, name: p1.name }, { id: p2.id, name: p2.name }]
  });

  assert.deepEqual(result.deterministicPatches, []);
  assert.deepEqual(result.modelCandidates.map((entity) => entity.id), [ambiguous.id]);
});

test('same stable link target repeated on distinct pages is deterministic global navigation', () => {
  const p1 = page('page:one', 'One', '/one');
  const p2 = page('page:two', 'Two', '/two');
  const global1 = control('field:g1', p1.id, 'Shared destination', { href: '/shared' });
  const global2 = control('field:g2', p2.id, 'Shared destination', { href: '/shared' });

  const result = resolveNavigationTopology({
    entityGraph: [p1, p2, global1, global2],
    currentEntities: [p2, global2],
    currentPageId: p2.id,
    recentPageTrail: [{ id: p1.id, name: p1.name }, { id: p2.id, name: p2.name }]
  });

  assert.equal(result.deterministicPatches[0]?.semantic.workflowRole, 'global');
  assert.equal(result.deterministicPatches[0]?.semantic.relevantToGoal, false);
  assert.deepEqual(result.modelCandidates, []);
});

test('repeated buttons without a stable href are not guessed to be global', () => {
  const p1 = page('page:one', 'One', '/one');
  const p2 = page('page:two', 'Two', '/two');
  const action1 = control('field:a1', p1.id, 'Same label', { controlType: 'button' });
  const action2 = control('field:a2', p2.id, 'Same label', { controlType: 'button' });

  const result = resolveNavigationTopology({
    entityGraph: [p1, p2, action1, action2],
    currentEntities: [p2, action2],
    currentPageId: p2.id,
    recentPageTrail: [{ id: p1.id, name: p1.name }, { id: p2.id, name: p2.name }]
  });

  assert.deepEqual(result.deterministicPatches, []);
  assert.deepEqual(result.modelCandidates.map((entity) => entity.id), [action2.id]);
});
