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

test('native radio inputs use nearest visible choice-wrapper text instead of shared technical name', async (t) => {
  const browser = await launchChrome();
  t.after(async () => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><body>
    <h1>Choose mode</h1>
    <section>
      <p>Which mode applies?</p>
      <div role="radiogroup">
        <div class="choice"><input type="radio" name="technical-radio-group" value="a"><span>First visible option</span></div>
        <div class="choice"><input type="radio" name="technical-radio-group" value="b"><span>Second visible option</span></div>
        <div class="choice"><input type="radio" name="technical-radio-group" value="c"><span>Third visible option</span></div>
      </div>
    </section>
  </body></html>`);

  const captured = buildStructuralEntities(await snapshotPage(page));
  const radios = captured.entities.filter((entity) => entity.type === 'ui_control' && entity.structural?.controlType === 'radio');
  assert.deepEqual(radios.map((entity) => entity.name), [
    'First visible option',
    'Second visible option',
    'Third visible option'
  ]);
  assert.equal(radios.some((entity) => entity.name === 'technical-radio-group'), false);

  const group = captured.entities.find((entity) => entity.type === 'group' && entity.structural?.cardinality === 'exactlyOne');
  assert.ok(group);
  assert.deepEqual(group.structural.values, [
    'First visible option',
    'Second visible option',
    'Third visible option'
  ]);
});
