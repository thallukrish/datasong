import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompactRunLogger } from '../src/diagnostics/compactRunLogger.js';

test('run logger writes layer-prefixed JSONL events immediately', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-run-log-'));
  const logger = await createCompactRunLogger({
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
  const logger = await createCompactRunLogger({ directory: dir, workflowId: 'wf', layer: 'layer27' });

  await assert.rejects(
    () => logger.log('input_applied', { entityId: 'field:1', value: 'PRIVATE' }),
    /sensitive|unsafe|value/i
  );
});

test('run logger keeps model I/O compact while preserving decision-relevant detail', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-run-log-'));
  const logger = await createCompactRunLogger({ directory: dir, workflowId: 'wf', layer: 'layer27' });
  const candidates = Array.from({ length: 35 }, (_, index) => ({
    id: `control:${index}`,
    label: `Candidate ${index} ${'x'.repeat(400)}`,
    controlType: 'button'
  }));
  const request = { operation: 'choose_navigation', payload: { query: `continue ${'q'.repeat(500)}`, candidates } };
  const response = { selectedEntityId: 'control:2', explanation: 'x'.repeat(1000) };

  await logger.logModelInput(request);
  await logger.logModelOutput(request.operation, response);

  const lines = (await fs.readFile(logger.path, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(lines[0].type, 'layer27.model.input');
  assert.equal(lines[0].request.operation, 'choose_navigation');
  assert.equal(lines[0].request.payload.candidates.length, 20);
  assert.equal(lines[0].request.payload.candidatesTruncated, 15);
  assert.ok(lines[0].request.payload.query.length <= 240);
  assert.ok(lines[0].request.payload.candidates[0].label.length <= 240);

  assert.equal(lines[1].type, 'layer27.model.output');
  assert.equal(lines[1].operation, 'choose_navigation');
  assert.equal(lines[1].response.selectedEntityId, 'control:2');
  assert.ok(lines[1].response.explanation.length <= 240);
});

test('run logger suppresses consecutive duplicate runtime events', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-run-log-'));
  const logger = await createCompactRunLogger({ directory: dir, workflowId: 'wf', layer: 'layer27' });

  await logger.log('navigation.candidates', { pageEntityId: 'page:1', entityCount: 3 });
  await logger.log('navigation.candidates', { pageEntityId: 'page:1', entityCount: 3 });
  await logger.log('navigation.candidates', { pageEntityId: 'page:1', entityCount: 4 });

  const lines = (await fs.readFile(logger.path, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => line.entityCount), [3, 4]);
  assert.deepEqual(lines.map((line) => line.sequence), [1, 2]);
});
