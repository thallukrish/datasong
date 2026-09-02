import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { snapshotPage } from '../src/browserCapture.js';
import { preprocessPage } from '../src/preprocess/pagePreprocessor.js';
import { projectPageState } from '../src/preprocess/stateProjection.js';
import { computeStateDelta } from '../src/preprocess/stateDelta.js';

const fixturePath = fileURLToPath(new URL('./fixtures/input-behavior.html', import.meta.url));

async function startFixtureServer() {
  const html = await fs.readFile(fixturePath, 'utf8');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/cities') {
      const q = String(url.searchParams.get('q') || '').toLowerCase();
      const cities = ['Bangalore', 'Bangkok', 'Chennai'].filter((name) => name.toLowerCase().startsWith(q));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(cities));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function launchChrome() {
  const options = { headless: true };
  if (process.env.LEMAP_CHROME) options.executablePath = process.env.LEMAP_CHROME;
  else options.channel = process.env.LEMAP_BROWSER_CHANNEL || 'chrome';
  return chromium.launch(options);
}

async function capture(page) {
  const snapshot = await snapshotPage(page);
  const model = preprocessPage(snapshot);
  const state = projectPageState(snapshot, model);
  return { snapshot, model, state };
}

function inputByLabel(model, label) {
  const input = model.inputs.find((candidate) => candidate.label === label);
  assert.ok(input, `expected input labelled ${label}`);
  return input;
}

async function freshPage(browser, url) {
  const page = await browser.newPage();
  await page.goto(url);
  return page;
}

test('browser preprocessor benchmark discovers and observes generic input behavior', async (t) => {
  const fixture = await startFixtureServer();
  const browser = await launchChrome();

  t.after(async () => {
    await browser.close();
    await fixture.close();
  });

  await t.test('discovers page identity, groups, input types and action plans from a live DOM', async () => {
    const page = await freshPage(browser, fixture.url);
    const { model } = await capture(page);

    assert.equal(model.page.mainLabel, 'Generic Filing Form');
    assert.ok(model.groups.some((group) => group.groupType === 'radio' && group.memberInputIds.length === 2));
    assert.ok(model.groups.some((group) => group.groupType === 'checkbox' && group.memberInputIds.length === 2));
    assert.equal(inputByLabel(model, 'Filing date').type, 'date');
    assert.equal(inputByLabel(model, 'City').type, 'autocomplete');
    assert.equal(inputByLabel(model, 'State').type, 'select');

    const reasonB = inputByLabel(model, 'Reason B');
    const condition1 = inputByLabel(model, 'Condition 1');
    assert.equal(model.actionPlans.find((plan) => plan.inputId === reasonB.id).executableNow, true);
    assert.equal(model.actionPlans.find((plan) => plan.inputId === condition1.id).executableNow, false);
    await page.close();
  });

  await t.test('radio selection exposes dependent inputs and hides completion action', async () => {
    const page = await freshPage(browser, fixture.url);
    const before = await capture(page);
    await page.locator('input[name="reason"][value="B"]').check();
    const after = await capture(page);
    const delta = computeStateDelta(before.state, after.state);

    const reasonB = inputByLabel(after.model, 'Reason B');
    const condition1 = inputByLabel(after.model, 'Condition 1');
    const condition2 = inputByLabel(after.model, 'Condition 2');
    const continueButton = inputByLabel(after.model, 'Continue');

    assert.ok(delta.inputValuesChanged.some((change) => change.inputId === reasonB.id && change.after === 'B'));
    assert.ok(delta.inputsEnabled.includes(condition1.id));
    assert.ok(delta.inputsEnabled.includes(condition2.id));
    assert.ok(delta.actionsHidden.includes(continueButton.id));
    await page.close();
  });

  await t.test('checkbox selection restores completion action', async () => {
    const page = await freshPage(browser, fixture.url);
    await page.locator('input[name="reason"][value="B"]').check();
    const before = await capture(page);
    await page.locator('#condition1').check();
    const after = await capture(page);
    const delta = computeStateDelta(before.state, after.state);
    const continueButton = inputByLabel(after.model, 'Continue');

    assert.ok(delta.actionsShown.includes(continueButton.id));
    await page.close();
  });

  await t.test('invalid date produces a normalized validation result', async () => {
    const page = await freshPage(browser, fixture.url);
    const before = await capture(page);
    await page.locator('#filingDate').fill('2025-09-13');
    await page.locator('#filingDate').blur();
    const after = await capture(page);
    const delta = computeStateDelta(before.state, after.state);

    assert.ok(delta.validationMessagesAdded.includes('Use DD/MM/YYYY'));
    await page.close();
  });

  await t.test('autocomplete captures async network behavior and resulting options', async () => {
    const page = await freshPage(browser, fixture.url);
    const requests = [];
    page.on('request', (request) => {
      if (request.url().includes('/cities?')) requests.push(request.url());
    });

    const before = await capture(page);
    await page.locator('#city').fill('ban');
    await page.waitForResponse((response) => response.url().includes('/cities?q=ban') && response.status() === 200);
    const after = await capture(page);
    const delta = computeStateDelta(before.state, after.state);
    const city = inputByLabel(after.model, 'City');

    assert.ok(requests.some((url) => url.includes('/cities?q=ban')));
    assert.deepEqual(delta.optionsAdded[city.id], ['Bangalore', 'Bangkok']);
    await page.close();
  });

  await t.test('select change captures dependent option-set changes', async () => {
    const page = await freshPage(browser, fixture.url);
    const before = await capture(page);
    await page.locator('#state').selectOption('KA');
    const after = await capture(page);
    const delta = computeStateDelta(before.state, after.state);
    const district = inputByLabel(after.model, 'District');

    assert.deepEqual(delta.optionsAdded[district.id], ['Choose', 'Bengaluru', 'Mysuru']);
    await page.close();
  });
});
