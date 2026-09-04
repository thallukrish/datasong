import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { snapshotPage } from '../src/browserCapture.js';
import { buildStructuralEntities } from '../src/graph/structuralEntityBuilder.js';

async function launchChrome() {
  const options = { headless: true };
  if (process.env.LEMAP_CHROME) options.executablePath = process.env.LEMAP_CHROME;
  else options.channel = process.env.LEMAP_BROWSER_CHANNEL || 'chrome';
  return chromium.launch(options);
}

test('visible blocking modal becomes the active page-like entity context', async (t) => {
  const browser = await launchChrome();
  t.after(async () => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <main>
      <h1>Return Filing</h1>
      <label>Return Type <select id="returnType"><option>Type A</option></select></label>
      <button id="underlyingContinue">Continue</button>
      <a href="/dashboard">Dashboard</a>
    </main>
    <div role="dialog" aria-modal="true" style="position:fixed;inset:20%;background:white;display:block">
      <p>Please ensure that the prerequisite request is approved before continuing.</p>
      <button id="modalCancel">Cancel</button>
      <button id="modalContinue">Continue</button>
    </div>
  `);

  const snapshot = await snapshotPage(page);
  const graph = buildStructuralEntities(snapshot);
  const active = graph.entities.find((entity) => entity.id === graph.pageId);
  const names = graph.entities.filter((entity) => entity.type === 'ui_control').map((entity) => entity.name).sort();

  assert.equal(snapshot.overlay.active, true);
  assert.equal(active.type, 'modal');
  assert.match(active.name, /prerequisite request is approved/i);
  assert.equal(graph.entities.some((entity) => entity.name === 'Return Type'), false);
  assert.deepEqual(names, ['Cancel', 'Continue']);
});
