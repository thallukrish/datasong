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
    semantic: { interaction: 'navigation', relevantToGoal: true, workflowRole: 'continue', navigationPriority: 90, consequence: 'reversible' },
    links: [
      { id: pageId, relationship: 'childOf' },
      ...(transitionsTo ? [{ id: transitionsTo, relationship: 'transitionsTo' }] : [])
    ]
  };
}

test('known transition to an earlier workflow page is deterministically back and excluded from model ranking', () => {
  const p1 = page('page:one', 'One', '/one');
  const p2 = page('page:two', 'Two', '/two');
  const back = control('field:back', p2.id, 'Edit one', { transitionsTo: p1.id });
  const forward = control('field:forward', p2.id, 'Continue', { controlType: 'button' });
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

test('href that uniquely resolves to an earlier page route is back before the link has been executed', () => {
  const p1 = page('page:status', 'Status', '/app#/status', 'https://example.test/app#/status');
  const p2 = page('page:form', 'Form', '/app#/form', 'https://example.test/app#/form');
  const status = control('field:status', p2.id, 'Select Status', { href: '#/status' });

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

test('same-route SPA states stay semantic unless a learned transition identifies the target page', () => {
  const route = '/app#/wizard';
  const p1 = page('page:state-one', 'Wizard State One', route, 'https://example.test/app#/wizard');
  const p2 = page('page:state-two', 'Wizard State Two', route, 'https://example.test/app#/wizard');
  const ambiguous = control('field:ambiguous', p2.id, 'Edit earlier state', { href: '#/wizard' });

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
  const dashboard1 = control('field:dash1', p1.id, 'Dashboard', { href: '/dashboard' });
  const dashboard2 = control('field:dash2', p2.id, 'Dashboard', { href: '/dashboard' });

  const result = resolveNavigationTopology({
    entityGraph: [p1, p2, dashboard1, dashboard2],
    currentEntities: [p2, dashboard2],
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
  const next1 = control('field:next1', p1.id, 'Continue', { controlType: 'button' });
  const next2 = control('field:next2', p2.id, 'Continue', { controlType: 'button' });

  const result = resolveNavigationTopology({
    entityGraph: [p1, p2, next1, next2],
    currentEntities: [p2, next2],
    currentPageId: p2.id,
    recentPageTrail: [{ id: p1.id, name: p1.name }, { id: p2.id, name: p2.name }]
  });

  assert.deepEqual(result.deterministicPatches, []);
  assert.deepEqual(result.modelCandidates.map((entity) => entity.id), [next2.id]);
});
