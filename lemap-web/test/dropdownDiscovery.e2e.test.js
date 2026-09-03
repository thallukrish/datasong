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

test('local explorer discovers dropdown domain and behavior, then restores original state', async (t) => {
  const fixture = await startServer();
  const browser = await launchChrome();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
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
