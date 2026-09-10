import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { snapshotPage } from '../src/browserCapture.js';
import { buildStructuralEntities } from '../src/graph/structuralEntityBuilder.js';

test('question text survives a single auxiliary control and keeps repeated answer pairs separate', async () => {
  const options = { headless: true };
  if (process.env.LEMAP_CHROME) options.executablePath = process.env.LEMAP_CHROME;
  else options.channel = process.env.LEMAP_BROWSER_CHANNEL || 'chrome';
  const browser = await chromium.launch(options);
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body>
      <h1>Questionnaire</h1>
      <section>
        <div class="question-block">
          <div>First eligibility question <button aria-label="More information">i</button></div>
          <div>Reference <a href="#ref1">details</a></div>
          <div><button>No</button><button>Yes</button></div>
        </div>
        <div class="question-block">
          <div>Second eligibility question <button aria-label="More information">i</button></div>
          <div>Reference <a href="#ref2">details</a></div>
          <div><button>No</button><button>Yes</button></div>
        </div>
        <div class="question-block">
          <div>Third eligibility question</div>
          <div><button>No</button><button>Yes</button></div>
        </div>
      </section>
    </body></html>`);

    const captured = buildStructuralEntities(await snapshotPage(page));
    const groups = captured.entities.filter((entity) => entity.type === 'group');
    const labels = groups.map((group) => group.name);

    assert.equal(groups.length, 3);
    assert.ok(labels.some((label) => /First eligibility question/.test(label)));
    assert.ok(labels.some((label) => /Second eligibility question/.test(label)));
    assert.ok(labels.some((label) => /Third eligibility question/.test(label)));
    for (const group of groups) assert.deepEqual(group.structural.values, ['No', 'Yes']);
  } finally {
    await browser.close();
  }
});
