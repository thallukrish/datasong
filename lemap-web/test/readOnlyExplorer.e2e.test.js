import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { exploreReadOnlyEntity } from '../src/explore/readOnlyExplorer.js';

async function launchChrome() {
  const options = { headless: true };
  if (process.env.LEMAP_CHROME) options.executablePath = process.env.LEMAP_CHROME;
  else options.channel = process.env.LEMAP_BROWSER_CHANNEL || 'chrome';
  return chromium.launch(options);
}

async function startServer() {
  const html = `<!doctype html><html><body><main><h1>Return Setup</h1>
  <script>
    window.__liveChangeCount = 0;
    window.__openCount = 0;
    const originalOpen = window.open;
    window.open = (...args) => { window.__openCount += 1; return originalOpen(...args); };
    document.addEventListener('change', () => { window.__liveChangeCount += 1; }, true);
  </script>
  <label>Assessment Year<select id="year"><option value="">Choose</option><option value="2026-27">2026-27</option></select></label>
  <fieldset><legend>Filing Mode</legend><label><input id="online" name="mode" type="radio" value="online" disabled>Online</label></fieldset>
  <button id="continue" disabled>Continue</button></main></body></html>`;
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}/`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function startMaterialLikeServer() {
  const html = `<!doctype html><html><body><main><h1>Setup</h1>
  <script>
    window.__liveChangeCount = 0;
    document.addEventListener('change', () => { window.__liveChangeCount += 1; }, true);
    function openOptions() {
      if (document.getElementById('overlay')) return;
      const overlay = document.createElement('div');
      overlay.id = 'overlay';
      overlay.innerHTML = '<div role="option">2025-26</div><div role="option">2026-27</div>';
      document.body.appendChild(overlay);
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') document.getElementById('overlay')?.remove();
    });
  </script>
  <mat-select id="year" role="combobox" aria-label="Assessment Year" onclick="openOptions()"></mat-select>
  </main></body></html>`;
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}/`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('read-only explorer opens no disposable tab and emits no live change event', async (t) => {
  const fixture = await startServer();
  const browser = await launchChrome();
  const context = await browser.newContext();
  const page = await context.newPage();
  t.after(async () => { await context.close(); await browser.close(); await fixture.close(); });
  await page.goto(fixture.url);

  const result = await exploreReadOnlyEntity(page);

  assert.equal(await page.evaluate(() => window.__openCount), 0);
  assert.equal(await page.evaluate(() => window.__liveChangeCount), 0);
  assert.equal(result.observations.length, 0);
  assert.equal(result.restored, true);
});

test('read-only explorer enumerates a closed finite combobox domain without selecting a value', async (t) => {
  const fixture = await startMaterialLikeServer();
  const browser = await launchChrome();
  const context = await browser.newContext();
  const page = await context.newPage();
  t.after(async () => { await context.close(); await browser.close(); await fixture.close(); });
  await page.goto(fixture.url);

  const result = await exploreReadOnlyEntity(page);
  const select = result.graph.fields.find((field) => field.domId === 'year');

  assert.ok(select);
  assert.deepEqual(result.valueDomains[select.id], ['2025-26', '2026-27']);
  assert.equal(await page.evaluate(() => window.__liveChangeCount), 0);
  assert.equal(await page.locator('#overlay').count(), 0);
  assert.equal(result.restored, true);
});
