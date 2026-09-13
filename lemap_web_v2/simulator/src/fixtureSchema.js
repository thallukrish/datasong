const FORBIDDEN_KEYS = new Set([
  'value',
  'values',
  'instance',
  'instances',
  'cookie',
  'cookies',
  'authorization',
  'token',
  'password',
  'secret',
  'html'
]);

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value;
}

function requireId(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function assertReplaySafe(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertReplaySafe(entry, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(String(key).toLowerCase())) {
      const location = [...path, key].join('.');
      throw new Error(`Replay fixture contains forbidden key ${key}${location ? ` at ${location}` : ''}.`);
    }
    assertReplaySafe(child, [...path, key]);
  }
}

function validateSnapshot(snapshot) {
  requireObject(snapshot, 'snapshot');
  if (snapshot.version !== 1) throw new Error('snapshot.version must be 1.');
  if (typeof snapshot.url !== 'string') throw new Error('snapshot.url must be a string.');
  if (typeof snapshot.title !== 'string') throw new Error('snapshot.title must be a string.');
  requireObject(snapshot.root, 'snapshot.root');
  if (typeof snapshot.root.tag !== 'string' || !snapshot.root.tag.trim()) {
    throw new Error('snapshot.root.tag must be a non-empty string.');
  }
  assertReplaySafe(snapshot);
  return snapshot;
}

export function validateReplayPage(page) {
  requireObject(page, 'Replay page');
  requireId(page.pageId, 'pageId');
  validateSnapshot(page.snapshot);
  assertReplaySafe(page);
  return structuredClone(page);
}

export function validateReplayTransition(transition) {
  requireObject(transition, 'Replay transition');
  requireId(transition.fromPageId, 'fromPageId');
  requireId(transition.actionEntityId, 'actionEntityId');
  if (transition.toPageId !== null) requireId(transition.toPageId, 'toPageId');
  assertReplaySafe(transition);
  return structuredClone(transition);
}

export function normalizeReplayFixture(input = {}) {
  requireObject(input, 'Replay fixture');
  assertReplaySafe(input);

  if (input.version !== 1) throw new Error('Replay fixture version must be 1.');
  const workflowId = requireId(input.workflowId, 'workflowId');
  const startPageId = requireId(input.startPageId, 'startPageId');
  if (!Array.isArray(input.pages)) throw new Error('Replay fixture pages must be an array.');
  if (!Array.isArray(input.transitions)) throw new Error('Replay fixture transitions must be an array.');

  const pages = input.pages.map(validateReplayPage);
  const pageIds = new Set();
  for (const page of pages) {
    if (pageIds.has(page.pageId)) throw new Error(`Duplicate page id: ${page.pageId}.`);
    pageIds.add(page.pageId);
  }
  if (!pageIds.has(startPageId)) throw new Error(`Start page is absent from fixture: ${startPageId}.`);

  const transitions = input.transitions.map(validateReplayTransition);
  const transitionKeys = new Set();
  const unknown = [];

  for (const transition of transitions) {
    if (!pageIds.has(transition.fromPageId)) {
      throw new Error(`Transition source page is absent: ${transition.fromPageId}.`);
    }
    if (transition.toPageId !== null && !pageIds.has(transition.toPageId)) {
      throw new Error(`Transition destination page is absent: ${transition.toPageId}.`);
    }

    const key = `${transition.fromPageId}\u0000${transition.actionEntityId}`;
    if (transitionKeys.has(key)) {
      throw new Error(`Competing transition for ${transition.fromPageId} / ${transition.actionEntityId}.`);
    }
    transitionKeys.add(key);
    if (transition.toPageId === null) unknown.push(transition);
  }

  if (unknown.length > 1) {
    throw new Error('A depth-first replay fixture may have only a single frontier.');
  }

  const frontier = unknown.length === 1
    ? { fromPageId: unknown[0].fromPageId, actionEntityId: unknown[0].actionEntityId }
    : null;

  return {
    version: 1,
    workflowId,
    startPageId,
    frontier,
    pages,
    transitions
  };
}
