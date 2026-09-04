import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { snapshotPage } from '../src/browserCapture.js';
import { buildStructuralEntities } from '../src/graph/structuralEntityBuilder.js';
import { createEntityGraph, findEntity } from '../src/graph/entityGraph.js';
import { applyObservedStructuralChange } from '../src/graph/structuralChange.js';

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
  return buildStructuralEntities(await snapshotPage(page));
}

function entityByName(entities, name) {
  const entity = entities.find((candidate) => candidate.name === name);
  assert.ok(entity, `expected entity named ${name}`);
  return entity;
}

async function freshPage(browser, url) {
  const page = await browser.newPage();
  await page.goto(url);
  return page;
}

test('browser benchmark builds and advances the unified entity graph', async (t) => {
  const fixture = await startFixtureServer();
  const browser = await launchChrome();
  t.after(async () => { await browser.close(); await fixture.close(); });

  await t.test('live DOM becomes page, group and control entities', async () => {
    const page = await freshPage(browser, fixture.url);
    const captured = await capture(page);
    const pageEntity = findEntity(captured.entities, captured.pageId);
    const reasonGroup = captured.entities.find((entity) => entity.type === 'group' && /filing reason/i.test(entity.name));
    const reasonB = entityByName(captured.entities, 'Reason B');
    const filingDate = entityByName(captured.entities, 'Filing date');
    const city = entityByName(captured.entities, 'City');

    assert.equal(pageEntity.type, 'page');
    assert.ok(reasonGroup);
    assert.equal(reasonB.structural.controlType, 'radio');
    assert.equal(filingDate.structural.controlType, 'date');
    assert.equal(city.structural.controlType, 'autocomplete');
    assert.ok(reasonB.links.some((link) => link.id === reasonGroup.id && link.relationship === 'partOf'));
    await page.close();
  });

  await t.test('real UI change creates causal state-version entities', async () => {
    const page = await freshPage(browser, fixture.url);
    const before = await capture(page);
    const persistent = createEntityGraph(before.entities);
    const reasonB = entityByName(before.entities, 'Reason B');
    const condition1Before = entityByName(before.entities, 'Condition 1');
    const continueBefore = entityByName(before.entities, 'Continue');

    await page.locator('input[name="reason"][value="B"]').check();
    const after = await capture(page);
    const change = applyObservedStructuralChange(persistent, {
      beforeEntities: before.entities,
      afterEntities: after.entities,
      triggerEntityId: reasonB.id,
      ignoredEntityIds: [reasonB.id]
    });

    assert.ok(change.versionEntityIds.length >= 2);
    const conditionVersion = change.versionEntityIds.map((id) => findEntity(persistent, id)).find((entity) => entity.links.some((link) => link.id === condition1Before.id && link.relationship === 'copyOf'));
    const continueVersion = change.versionEntityIds.map((id) => findEntity(persistent, id)).find((entity) => entity.links.some((link) => link.id === continueBefore.id && link.relationship === 'copyOf'));
    assert.ok(conditionVersion);
    assert.equal(conditionVersion.structural.disabled, false);
    assert.ok(conditionVersion.links.some((link) => link.id === reasonB.id && link.relationship === 'onModificationOf'));
    assert.ok(continueVersion);
    assert.equal(continueVersion.structural.visible, false);
    await page.close();
  });
});
