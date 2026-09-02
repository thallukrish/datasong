import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { snapshotPage } from '../src/browserCapture.js';
import { preprocessEntity } from '../src/graph/entityPreprocessor.js';
import { projectEntityState } from '../src/graph/entityState.js';
import { computeEntityDelta } from '../src/graph/entityDelta.js';
import { exploreLocalEntity } from '../src/explore/localExplorer.js';
import { collectNavigationCandidates } from '../src/explore/navigationCandidates.js';

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
  return { url: `http://127.0.0.1:${address.port}/`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

async function launchChrome() {
  const options = { headless: true };
  if (process.env.LEMAP_CHROME) options.executablePath = process.env.LEMAP_CHROME;
  else options.channel = process.env.LEMAP_BROWSER_CHANNEL || 'chrome';
  return chromium.launch(options);
}

async function capture(page) {
  const snapshot = await snapshotPage(page);
  const graph = preprocessEntity(snapshot);
  const state = projectEntityState(snapshot, graph);
  return { snapshot, graph, state };
}

function controlByLabel(graph, label) {
  const control = [...graph.fields, ...graph.actions].find((candidate) => candidate.label === label);
  assert.ok(control, `expected control labelled ${label}`);
  return control;
}

async function freshPage(browser, url) {
  const page = await browser.newPage();
  await page.goto(url);
  return page;
}

test('browser entity benchmark discovers and observes generic behavior', async (t) => {
  const fixture = await startFixtureServer();
  const browser = await launchChrome();
  t.after(async () => { await browser.close(); await fixture.close(); });

  await t.test('discovers entity identity, fields, groups and methods from live DOM', async () => {
    const page = await freshPage(browser, fixture.url);
    const { graph } = await capture(page);
    assert.equal(graph.entity.label, 'Generic Filing Form');
    assert.ok(graph.entity.presentation.pageId);
    assert.ok(graph.groups.some((group) => group.groupType === 'radio' && group.memberFieldIds.length === 2));
    assert.equal(controlByLabel(graph, 'Filing date').type, 'date');
    assert.equal(controlByLabel(graph, 'City').type, 'autocomplete');
    const reasonB = controlByLabel(graph, 'Reason B');
    const condition1 = controlByLabel(graph, 'Condition 1');
    assert.equal(graph.methods.find((method) => method.fieldId === reasonB.id).executableNow, true);
    assert.equal(graph.methods.find((method) => method.fieldId === condition1.id).executableNow, false);
    await page.close();
  });

  await t.test('radio selection changes fields outside the local radio group', async () => {
    const page = await freshPage(browser, fixture.url);
    const before = await capture(page);
    await page.locator('input[name="reason"][value="B"]').check();
    const after = await capture(page);
    const delta = computeEntityDelta(before.state, after.state);
    const reasonB = controlByLabel(after.graph, 'Reason B');
    const condition1 = controlByLabel(after.graph, 'Condition 1');
    const condition2 = controlByLabel(after.graph, 'Condition 2');
    const continueButton = controlByLabel(after.graph, 'Continue');
    assert.ok(delta.fieldValuesChanged.some((change) => change.fieldId === reasonB.id && change.after === 'B'));
    assert.ok(delta.fieldsEnabled.includes(condition1.id));
    assert.ok(delta.fieldsEnabled.includes(condition2.id));
    assert.ok(delta.actionsHidden.includes(continueButton.id));
    await page.close();
  });

  await t.test('checkbox selection restores completion action', async () => {
    const page = await freshPage(browser, fixture.url);
    await page.locator('input[name="reason"][value="B"]').check();
    const before = await capture(page);
    await page.locator('#condition1').check();
    const after = await capture(page);
    const delta = computeEntityDelta(before.state, after.state);
    const continueButton = controlByLabel(after.graph, 'Continue');
    assert.ok(delta.actionsShown.includes(continueButton.id));
    await page.close();
  });

  await t.test('automatic local explorer probes radio branch, discovers enabled checkbox behavior, restores state, and retains outgoing navigation candidates', async () => {
    const page = await freshPage(browser, fixture.url);
    const before = await capture(page);
    const result = await exploreLocalEntity(page, { settleMs: 25 });
    const after = await capture(page);
    const candidates = await collectNavigationCandidates(page, after.graph);

    const reasonB = controlByLabel(before.graph, 'Reason B');
    const condition1 = controlByLabel(before.graph, 'Condition 1');
    const condition2 = controlByLabel(before.graph, 'Condition 2');
    const continueButton = controlByLabel(before.graph, 'Continue');

    assert.ok(result.observations.some((observation) => observation.fieldId === reasonB.id && observation.delta.fieldsEnabled.includes(condition1.id) && observation.delta.actionsHidden.includes(continueButton.id)));
    assert.ok(result.observations.some((observation) => observation.fieldId === condition1.id && observation.delta.actionsShown.includes(continueButton.id)));
    assert.ok(result.learnedRelationships.some((relationship) => relationship.kind === 'mutually_exclusive' && relationship.groupType === 'radio'));
    assert.ok(result.learnedRelationships.some((relationship) => relationship.kind === 'multi_select' && relationship.groupType === 'checkbox' && relationship.memberFieldIds.includes(condition1.id) && relationship.memberFieldIds.includes(condition2.id)));
    assert.deepEqual(after.state.fields, before.state.fields);
    assert.equal(result.restored, true);
    assert.ok(candidates.some((candidate) => candidate.label === 'Continue' && candidate.kind === 'action'));
    assert.ok(candidates.some((candidate) => candidate.label === 'Dashboard' && candidate.kind === 'link' && candidate.href.endsWith('/dashboard')));
    assert.ok(candidates.some((candidate) => candidate.label === 'Home' && candidate.kind === 'link' && candidate.href.endsWith('/home')));
    await page.close();
  });

  await t.test('validation and dynamic options remain structural entity evidence', async () => {
    const page = await freshPage(browser, fixture.url);
    const before = await capture(page);
    await page.locator('#filingDate').fill('2025-09-13');
    await page.locator('#filingDate').blur();
    const invalid = await capture(page);
    const validationDelta = computeEntityDelta(before.state, invalid.state);
    assert.ok(validationDelta.validationMessagesAdded.includes('Use DD/MM/YYYY'));

    const responsePromise = page.waitForResponse((response) => response.url().includes('/cities?q=ban') && response.status() === 200);
    const beforeAuto = await capture(page);
    await page.locator('#city').fill('ban');
    await responsePromise;
    const afterAuto = await capture(page);
    const optionDelta = computeEntityDelta(beforeAuto.state, afterAuto.state);
    const city = controlByLabel(afterAuto.graph, 'City');
    assert.deepEqual(optionDelta.optionsAdded[city.id], ['Bangalore', 'Bangkok']);
    await page.close();
  });
});