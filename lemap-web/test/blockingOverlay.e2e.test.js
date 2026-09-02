import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { snapshotPage } from '../src/browserCapture.js';
import { preprocessEntity } from '../src/graph/entityPreprocessor.js';
import { collectNavigationCandidates } from '../src/explore/navigationCandidates.js';

async function launchChrome() {
  const options = { headless: true };
  if (process.env.LEMAP_CHROME) options.executablePath = process.env.LEMAP_CHROME;
  else options.channel = process.env.LEMAP_BROWSER_CHANNEL || 'chrome';
  return chromium.launch(options);
}

test('visible blocking modal becomes current entity and hides underlying navigation', async (t) => {
  const browser = await launchChrome();
  t.after(async () => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <main>
      <h1>Return Filing</h1>
      <label>ITR Type <select id="itr"><option>ITR-3</option></select></label>
      <button id="underlyingContinue">Continue</button>
      <a href="/dashboard">Dashboard</a>
    </main>
    <div role="dialog" aria-modal="true" style="position:fixed;inset:20%;background:white;display:block">
      <p>Please ensure that the prerequisite request is approved before filing the ITR.</p>
      <button id="modalCancel">Cancel</button>
      <button id="modalContinue">Continue</button>
    </div>
  `);

  const snapshot = await snapshotPage(page);
  const graph = preprocessEntity(snapshot);
  const candidates = await collectNavigationCandidates(page, graph);

  assert.equal(snapshot.overlay.active, true);
  assert.equal(graph.entity.presentation.overlay, true);
  assert.match(graph.entity.label, /prerequisite request is approved/i);
  assert.equal(graph.fields.some((field) => field.label === 'ITR Type'), false);
  assert.deepEqual(graph.actions.map((action) => action.label).sort(), ['Cancel', 'Continue']);
  assert.deepEqual(candidates.map((candidate) => candidate.label).sort(), ['Cancel', 'Continue']);
});
