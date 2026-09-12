import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRunLogger } from '../src/diagnostics/runLogger.js';

test('run logger writes a layer-prefixed event immediately', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-run-log-'));
  const logger = await createRunLogger({ directory: dir, workflowId: 'workflow:abc', layer: 'layer27', now: () => new Date('2026-09-12T12:00:00.000Z') });
  await logger.log('capture', { pageEntityId: 'page:1', entityCount: 12 });
  const lines = (await fs.readFile(logger.path, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type, 'layer27.capture');
  assert.equal(lines[0].pageEntityId, 'page:1');
  assert.equal(lines[0].entityCount, 12);
});

test('run logger preserves compact model request and response envelopes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-run-log-'));
  const logger = await createRunLogger({ directory: dir, workflowId: 'wf', layer: 'layer27' });
  const request = { operation: 'choose_navigation', payload: { query: 'continue', candidates: [{ id: 'next', label: 'Continue' }] } };
  const response = { selectedEntityId: 'next' };
  await logger.logModelInput(request);
  await logger.logModelOutput(request.operation, response);
  const lines = (await fs.readFile(logger.path, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(lines[0].request, request);
  assert.deepEqual(lines[1].response, response);
});
