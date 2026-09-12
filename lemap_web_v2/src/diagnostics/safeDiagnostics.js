const SAFE_SCALAR_FIELDS = new Set([
  'stage',
  'pageEntityId',
  'frameId',
  'entityId',
  'workflowId',
  'operation',
  'errorCode',
  'entityCount',
  'durationMs',
  'tokenCount',
  'step',
  'retryable',
  'completed',
  'reusedPage'
]);

const SAFE_ID_ARRAY_FIELDS = new Set([
  'visibleEntityIds',
  'selectedEntityIds',
  'addedEntityIds',
  'hiddenEntityIds',
  'revealedRootIds'
]);

function assertState(state) {
  if (!state || !Array.isArray(state.events)) {
    throw new Error('A diagnostics state with events is required.');
  }
}

function cleanScalar(value) {
  if (typeof value === 'string') return value.slice(0, 240);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function cleanIds(values) {
  if (!Array.isArray(values)) return undefined;
  return [...new Set(values.filter(Boolean).map((value) => String(value).slice(0, 240)))];
}

function sanitizeData(data = {}) {
  const safe = {};

  for (const [key, value] of Object.entries(data || {})) {
    if (SAFE_SCALAR_FIELDS.has(key)) {
      const cleaned = cleanScalar(value);
      if (cleaned !== undefined) safe[key] = cleaned;
      continue;
    }

    if (SAFE_ID_ARRAY_FIELDS.has(key)) {
      const cleaned = cleanIds(value);
      if (cleaned !== undefined) safe[key] = cleaned;
    }
  }

  return safe;
}

export function createDiagnostics({ runId = '', sink = null } = {}) {
  if (sink !== null && typeof sink !== 'function') {
    throw new Error('diagnostic sink must be a function.');
  }

  return {
    version: 1,
    runId: String(runId || ''),
    events: [],
    sink
  };
}

export function recordDiagnosticEvent(state, type, data = {}) {
  assertState(state);
  const normalizedType = String(type || '').trim();
  if (!normalizedType) throw new Error('Diagnostic event type is required.');

  const event = {
    sequence: state.events.length + 1,
    type: normalizedType.slice(0, 120),
    ...sanitizeData(data)
  };

  state.events.push(event);
  if (typeof state.sink === 'function') {
    state.sink(structuredClone(event));
  }
  return event;
}

export function diagnosticSnapshot(state) {
  assertState(state);
  return {
    version: 1,
    runId: String(state.runId || ''),
    events: structuredClone(state.events)
  };
}
