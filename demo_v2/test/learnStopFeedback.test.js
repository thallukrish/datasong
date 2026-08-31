import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../public/learnStatus.js', import.meta.url));
const source = fs.readFileSync(file, 'utf8');

function statusApi() {
  const sandbox = { globalThis: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.globalThis.LeMapLearnStatus;
}

test('activity reports cooperative stop immediately while current reasoning step winds down', () => {
  const api = statusApi();
  const arcs = [{ id: 'arc-1', title: 'Checkout', progress: 50 }];
  const state = { status: 'exploring', stopRequested: true, pass1Scheduler: { activeArcId: 'arc-1' } };
  assert.match(api.activity(arcs, state, true), /Stopping/i);
  assert.match(api.workflowState(arcs[0], state, true), /Stopping/i);
});

test('browser helper gives Stop an immediate disabled stopping state', () => {
  assert.match(source, /addEventListener\(['"]click['"]/);
  assert.match(source, /Stopping…/);
  assert.match(source, /classList\.add\(['"]stopping['"]\)/);
});
