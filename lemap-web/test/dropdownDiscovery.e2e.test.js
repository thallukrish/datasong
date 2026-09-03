import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { exploreLocalEntity } from '../src/explore/localExplorer.js';
import { snapshotPage } from '../src/browserCapture.js';
import { preprocessEntity } from '../src/graph/entityPreprocessor.js';

async function launchChrome() {
  const options = { headless: true };
  if (process.env.LEMAP_CHROME) options.executablePath = process.env.LEMAP_CHROME;
  else options.channel = process.env.LEMAP_BROWSER_CHANNEL || 'chrome';
  return chromium.launch(options);
}

async function openTestPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

async function startServer() {
  const html = `<!doctype html><html><body><main><h1>Return Setup</h1>
  <label>Assessment Year<select id="year" onchange="document.getElementById('mode').disabled=!this.value; document.getElementById('continue').disabled=!(this.value && document.querySelector('input[name=mode]:checked'))"><option value="">Choose</option><option value="2026-27">2026-27</option><option value="2025-26">2025-26</option></select></label>
  <fieldset><legend>Filing Mode</legend><label><input id="online" name="mode" type="radio" value="online" disabled onchange="document.getElementById('continue').disabled=!(document.getElementById('year').value && this.checked)">Online</label><label><input id="offline" name="mode" type="radio" value="offline" disabled onchange="document.getElementById('continue').disabled=!(document.getElementById('year').value && this.checked)">Offline</label></fieldset>
  <button id="continue" disabled>Continue</button></main></body></html>`;
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}/`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function startMaterialLikeServer() {
  const html = `<!doctype html><html><body><main><h1>Return Setup</h1>
  <mat-select id="year" role="listbox" aria-label="Assessment Year" tabindex="0">Select</mat-select>
  <div id="panel" hidden>
    <div role="option" aria-disabled="true">Select</div>
    <div role="option">2026-27 (Current A.Y.)</div>
    <div role="option">2025-26</div>
  </div>
  <fieldset><legend>Filing Mode</legend>
    <label><input id="online" name="mode" type="radio" value="online" disabled>Online</label>
    <label><input id="offline" name="mode" type="radio" value="offline" disabled>Offline</label>
  </fieldset>
  <button id="continue" disabled>Continue</button>
  <script>
    const select = document.getElementById('year');
    const panel = document.getElementById('panel');
    select.addEventListener('click', () => { panel.hidden = false; });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') panel.hidden = true; });
    panel.querySelectorAll('[role=option]').forEach((option) => option.addEventListener('click', () => {
      if (option.getAttribute('aria-disabled') === 'true') return;
      select.textContent = option.textContent;
      option.setAttribute('aria-selected', 'true');
      document.getElementById('online').disabled = false;
      document.getElementById('offline').disabled = false;
      panel.hidden = true;
    }));
  </script></main></body></html>`;
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}/`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('local explorer discovers dropdown domain and behavior, then restores original state', async (t) => {
  const fixture = await startServer();
  const browser = await launchChrome();
  const { context, page } = await openTestPage(browser);
  t.after(async () => { await context.close(); await browser.close(); await fixture.close(); });
  await page.goto(fixture.url);
  const snapshot = await snapshotPage(page);
  const graph = preprocessEntity(snapshot);
  const year = graph.fields.find((field) => field.label === 'Assessment Year');
  assert.ok(year);
  assert.equal(year.type, 'select');

  const result = await exploreLocalEntity(page, { settleMs: 10, probeBehavior: true });
  assert.deepEqual(result.valueDomains[year.id], ['Choose', '2026-27', '2025-26']);
  assert.ok(result.learnedRelationships.some((relationship) => relationship.kind === 'value_domain' && relationship.sourceFieldId === year.id));
  assert.ok(result.observations.some((observation) => observation.fieldId === year.id && observation.action.kind === 'select_option'));
  assert.ok(result.learnedRelationships.some((relationship) => relationship.kind === 'action_effect' && relationship.sourceFieldId === year.id));
  assert.equal(await page.locator('#year').inputValue(), '');
  assert.equal(await page.locator('#online').isDisabled(), true);
  assert.equal(await page.locator('#continue').isDisabled(), true);
  assert.equal(result.restored, true);
});

test('irreversible material-like select is behaviorally explored even when context.newPage is unavailable', async (t) => {
  const fixture = await startMaterialLikeServer();
  const browser = await launchChrome();
  const page = await browser.newPage();
  t.after(async () => { await browser.close(); await fixture.close(); });
  await page.goto(fixture.url);
  const snapshot = await snapshotPage(page);
  const graph = preprocessEntity(snapshot);
  const year = graph.fields.find((field) => field.label === 'Assessment Year');
  const online = graph.fields.find((field) => field.label === 'Online');
  assert.ok(year);
  assert.ok(online);
  assert.equal(year.type, 'select');

  const result = await exploreLocalEntity(page, { settleMs: 10, probeBehavior: true });
  const selectObservations = result.observations.filter((observation) => observation.action?.kind === 'select_option');
  const behaviorRelationships = result.learnedRelationships.filter((relationship) => ['behavior_classes', 'disposable_probe', 'probe_skipped'].includes(relationship.kind));
  const diagnostics = JSON.stringify({ yearId: year.id, onlineId: online.id, errors: result.errors, selectObservations, behaviorRelationships }, null, 2);

  assert.ok(result.valueDomains[year.id].includes('2026-27 (Current A.Y.)'));
  assert.equal(result.errors.length, 0, diagnostics);
  assert.ok(selectObservations.some((observation) => observation.fieldId === year.id && observation.delta.fieldsEnabled.includes(online.id)), diagnostics);
  assert.ok(result.learnedRelationships.some((relationship) => relationship.kind === 'behavior_classes' && relationship.sourceFieldId === year.id), diagnostics);
  assert.ok(result.learnedRelationships.some((relationship) => relationship.kind === 'disposable_probe' && relationship.sourceFieldId === year.id), diagnostics);
  assert.equal((await page.locator('#year').innerText()).trim(), 'Select');
  assert.equal(await page.locator('#online').isDisabled(), true);
  assert.equal(await page.locator('#offline').isDisabled(), true);
  assert.equal(await page.locator('#panel').isHidden(), true);
  assert.equal(result.restored, true);
});
