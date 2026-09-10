import test from 'node:test';
import assert from 'node:assert/strict';
import { planNavigation } from '../src/agent/navigationPlanner.js';

function page(id, name, route) {
  return { id, name, type: 'page', structural: { route, url: `https://example.test${route}` }, semantic: {}, links: [] };
}

function action(id, pageId, name, { href = '', transitionsTo = '' } = {}) {
  return {
    id,
    name,
    type: 'ui_control',
    structural: { controlType: href ? 'link' : 'button', href, visible: true, disabled: false },
    semantic: {},
    links: [
      { id: pageId, relationship: 'childOf' },
      ...(transitionsTo ? [{ id: transitionsTo, relationship: 'transitionsTo' }] : [])
    ]
  };
}

test('planner reuses one learned forward transition without calling the model', async () => {
  const first = page('page:first', 'First', '/first');
  const current = page('page:current', 'Current', '/current');
  const next = page('page:next', 'Next', '/next');
  const forward = action('action:forward', current.id, 'Advance', { transitionsTo: next.id });
  let modelCalls = 0;

  const result = await planNavigation({
    entityGraph: [first, current, next, forward],
    currentEntities: [current, forward],
    currentPageId: current.id,
    recentPageTrail: [{ id: first.id, name: first.name }, { id: current.id, name: current.name }],
    choose: async () => { modelCalls += 1; return null; }
  });

  assert.equal(result.entity?.id, forward.id);
  assert.equal(result.source, 'learned_transition');
  assert.equal(modelCalls, 0);
});

test('planner executes the sole unresolved candidate without calling the model', async () => {
  const current = page('page:current', 'Current', '/current');
  const only = action('action:only', current.id, 'Advance');
  let modelCalls = 0;

  const result = await planNavigation({
    entityGraph: [current, only],
    currentEntities: [current, only],
    currentPageId: current.id,
    recentPageTrail: [{ id: current.id, name: current.name }],
    choose: async () => { modelCalls += 1; return null; }
  });

  assert.equal(result.entity?.id, only.id);
  assert.equal(result.source, 'sole_candidate');
  assert.equal(modelCalls, 0);
});

test('planner asks the model only after structural filtering leaves multiple unresolved candidates', async () => {
  const previous = page('page:previous', 'Previous', '/previous');
  const current = page('page:current', 'Current', '/current');
  const back = action('action:back', current.id, 'Earlier', { href: '/previous' });
  const one = action('action:one', current.id, 'Choice A');
  const two = action('action:two', current.id, 'Choice B');
  let seen = [];

  const result = await planNavigation({
    entityGraph: [previous, current, back, one, two],
    currentEntities: [current, back, one, two],
    currentPageId: current.id,
    recentPageTrail: [{ id: previous.id, name: previous.name }, { id: current.id, name: current.name }],
    choose: async ({ candidates }) => { seen = candidates.map((item) => item.id); return two; }
  });

  assert.deepEqual(seen, [one.id, two.id]);
  assert.equal(result.entity?.id, two.id);
  assert.equal(result.source, 'model_choice');
  assert.equal(result.topologyCount, 1);
});
