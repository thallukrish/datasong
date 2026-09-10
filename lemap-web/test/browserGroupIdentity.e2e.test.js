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

async function capture(page) {
  return buildStructuralEntities(await snapshotPage(page));
}

test('radio group identity ignores generated DOM id changes when controls have no HTML name', async (t) => {
  const browser = await launchChrome();
  const page = await browser.newPage();
  t.after(async () => browser.close());

  await page.setContent(`<!doctype html><html><body><main><h1>Status</h1>
    <fieldset><legend>Taxpayer Status</legend>
      <label><input id="generated-a-1" type="radio" value="individual">Individual</label>
      <label><input id="generated-a-2" type="radio" value="huf">HUF</label>
    </fieldset>
  </main></body></html>`);

  const before = await capture(page);
  const beforeGroup = before.entities.find((entity) => entity.type === 'group' && entity.name === 'Taxpayer Status');
  assert.ok(beforeGroup);

  await page.evaluate(() => {
    document.querySelector('input[value="individual"]').id = 'generated-b-91';
    document.querySelector('input[value="huf"]').id = 'generated-b-92';
  });

  const after = await capture(page);
  const afterGroup = after.entities.find((entity) => entity.type === 'group' && entity.name === 'Taxpayer Status');
  assert.ok(afterGroup);
  assert.equal(afterGroup.id, beforeGroup.id);
});
