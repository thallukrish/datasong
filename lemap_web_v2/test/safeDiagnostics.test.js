import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDiagnostics,
  recordDiagnosticEvent,
  diagnosticSnapshot
} from '../src/diagnostics/safeDiagnostics.js';

test('records only allowlisted diagnostic fields', () => {
  const diagnostics = createDiagnostics({ runId: 'run:1' });
  const event = recordDiagnosticEvent(diagnostics, 'page_ingested', {
    stage: 'ingest',
    pageEntityId: 'page:a',
    frameId: 'frame:1',
    entityCount: 12,
    durationMs: 34,
    userValue: 'SECRET',
    prompt: 'do not log me'
  });

  assert.deepEqual(event, {
    sequence: 1,
    type: 'page_ingested',
    stage: 'ingest',
    pageEntityId: 'page:a',
    frameId: 'frame:1',
    entityCount: 12,
    durationMs: 34
  });
  assert.equal(JSON.stringify(event).includes('SECRET'), false);
  assert.equal('prompt' in event, false);
});

test('supports safe ids, counts, booleans and stable error codes', () => {
  const diagnostics = createDiagnostics();
  const event = recordDiagnosticEvent(diagnostics, 'action_failed', {
    entityId: 'control:a',
    workflowId: 'workflow:1',
    visibleEntityIds: ['control:a', 'control:b', 'control:a'],
    retryable: true,
    errorCode: 'LOCATOR_NOT_FOUND',
    errorMessage: 'sensitive free text'
  });

  assert.deepEqual(event.visibleEntityIds, ['control:a', 'control:b']);
  assert.equal(event.retryable, true);
  assert.equal(event.errorCode, 'LOCATOR_NOT_FOUND');
  assert.equal('errorMessage' in event, false);
});

test('rejects unsupported event types and malformed diagnostics state', () => {
  const diagnostics = createDiagnostics();
  assert.throws(() => recordDiagnosticEvent(diagnostics, '', {}), /type/i);
  assert.throws(() => recordDiagnosticEvent({}, 'x', {}), /diagnostics/i);
});

test('optional sink receives a detached safe event', () => {
  const received = [];
  const diagnostics = createDiagnostics({ sink: (event) => received.push(event) });
  const event = recordDiagnosticEvent(diagnostics, 'semantic_call', {
    operation: 'enrich_entities',
    selectedEntityIds: ['control:a'],
    tokenCount: 120
  });

  received[0].operation = 'changed';
  assert.equal(event.operation, 'enrich_entities');
  assert.equal(diagnostics.events[0].operation, 'enrich_entities');
});

test('diagnosticSnapshot is detached and contains no sink function', () => {
  const diagnostics = createDiagnostics({ runId: 'run:7', sink: () => {} });
  recordDiagnosticEvent(diagnostics, 'complete', { step: 4, completed: true });

  const snapshot = diagnosticSnapshot(diagnostics);
  assert.deepEqual(snapshot, {
    version: 1,
    runId: 'run:7',
    events: [{ sequence: 1, type: 'complete', step: 4, completed: true }]
  });
  snapshot.events[0].step = 99;
  assert.equal(diagnostics.events[0].step, 4);
});
