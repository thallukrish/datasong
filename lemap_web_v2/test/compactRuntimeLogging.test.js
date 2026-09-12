import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeLogView } from '../src/diagnostics/runtimeLogView.js';

test('runtime log view caps id arrays and suppresses consecutive duplicates', async () => {
  const events = [];
  const base = {
    path: 'data/logs/run.jsonl',
    layer: 'layer27',
    log: async (type, data) => {
      events.push({ type, data });
      return { type, ...data };
    }
  };
  const logger = createRuntimeLogView(base, { maxIds: 8 });
  const ids = Array.from({ length: 25 }, (_, index) => `control:${index}`);

  await logger.log('navigation.candidates', { pageEntityId: 'page:1', entityCount: 25, selectedEntityIds: ids });
  await logger.log('navigation.candidates', { pageEntityId: 'page:1', entityCount: 25, selectedEntityIds: ids });

  assert.equal(events.length, 1);
  assert.equal(events[0].data.entityCount, 25);
  assert.equal(events[0].data.selectedEntityIds.length, 8);
  assert.equal(events[0].data.selectedEntityIdsTruncated, 17);
  assert.equal(logger.path, base.path);
});
