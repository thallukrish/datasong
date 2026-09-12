import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRunLogger } from '../src/diagnostics/runLogger.js';

test('run logger writes layer-prefixed JSONL events immediately', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-run-log-'));
  const logger = await createRunLogger({
    directory: dir,
    workflowId: 'workflow:abc',
    layer: 'layer27',
    now: () => new Date('2026-09-12T12:00:00.000Z')
  });

  await logger.log('capture', { pageEntityId: 'page:1', entityCount: 12 });
  const text = await fs.readFile(logger.path, 'utf8');
  const lines = text.trim().split(/\r?\n/);

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    sequence: 1,
    timestamp: '2026-09-12T12:00:00.000Z',
    type: 'layer27.capture',
    pageEntityId: 'page:1',
    entityCount: 12
  });
  assert.match(path.basename(logger.path), /^layer27-run-workflow-abc-20260912T120000000Z\.jsonl$/);
});

test('run logger rejects sensitive runtime fields', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-run-log-'));
  const logger = await createRunLogger({ directory: dir, workflowId: 'wf', layer: 'layer27' });

  await assert.rejects(
    () => logger.log('input_applied', { entityId: 'field:1', value: 'PRIVATE' }),
    /sensitive|unsafe|value/i
  );
});

test('run logger permits exact model request and response envelopes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-run-log-'));
  const logger = await createRunLogger({ directory: dir, workflowId: 'wf', layer: 'layer27' });
  const request = { operation: 'choose_navigation', payload: { query: 'continue', candidates: [{ id: 'next', label: 'Continue' }] } };
  const response = { selectedEntityId: 'next' };

  await logger.logModelInput(request);
  await logger.logModelOutput(request.operation, response);

  const lines = (await fs.readFile(logger.path, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(lines[0].type, 'layer27.model.input');
  assert.deepEqual(lines[0].request, request);
  assert.equal(lines[1].type, 'layer27.model.output');
  assert.equal(lines[1].operation, 'choose_navigation');
  assert.deepEqual(lines[1].response, response);
});
