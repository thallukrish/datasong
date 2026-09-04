import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';
import { chromium } from 'playwright-core';
import {
  choosePage,
  installUserEventProbe,
  readUserEvents,
  snapshotPage,
  summarizeNetworkEvent
} from './browserCapture.js';
import { buildStructuralEntities } from './graph/structuralEntityBuilder.js';
import { applyObservedStructuralChange } from './graph/structuralChange.js';
import { createEntityGraph, findEntity, linkEntities, upsertEntity } from './graph/entityGraph.js';

const endpoint = process.env.LEMAP_CDP || 'http://127.0.0.1:9222';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function arr(value) { return Array.isArray(value) ? value : []; }

function sourceEntity(entities, event) {
  if (!event) return null;
  return arr(entities).find((entity) => entity.type === 'ui_control' && (
    entity.name === event.label || entity.structural?.name === event.controlName
  )) || null;
}

function addMissing(graph, entities) {
  for (const entity of arr(entities)) if (!findEntity(graph, entity.id)) upsertEntity(graph, entity);
}

let browser;
try {
  browser = await chromium.connectOverCDP(endpoint);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = choosePage(pages);
  if (!page) throw new Error('No Chrome tabs found on the CDP connection.');

  console.log(`[lemap-web] attached to ${endpoint}`);
  console.log(`[lemap-web] tab: ${await page.title()} :: ${page.url()}`);

  const network = [];
  const onRequest = (request) => {
    if (!['xhr', 'fetch', 'document'].includes(request.resourceType())) return;
    network.push(summarizeNetworkEvent({ phase: 'request', method: request.method(), url: request.url() }));
  };
  const onResponse = (response) => {
    const request = response.request();
    if (!['xhr', 'fetch', 'document'].includes(request.resourceType())) return;
    network.push(summarizeNetworkEvent({ phase: 'response', method: request.method(), url: response.url(), status: response.status() }));
  };
  page.on('request', onRequest);
  page.on('response', onResponse);

  const beforeSnapshot = await snapshotPage(page);
  const before = buildStructuralEntities(beforeSnapshot);
  const graph = createEntityGraph(before.entities);
  await installUserEventProbe(page);

  console.log(`[lemap-web] page entity: ${before.pageId}`);
  console.log(`[lemap-web] entities: ${before.entities.length}`);
  await rl.question('\nPerform ONE meaningful action in the attached Chrome tab, wait for the UI to settle, then press Enter here... ');
  await page.waitForTimeout(700);

  const events = await readUserEvents(page);
  const afterSnapshot = await snapshotPage(page);
  const after = buildStructuralEntities(afterSnapshot);
  const meaningfulEvent = [...events].reverse().find((event) => ['change', 'click', 'submit', 'input'].includes(event.name)) || null;
  const trigger = sourceEntity(before.entities, meaningfulEvent);

  let change = { addedEntityIds: [], versionEntityIds: [] };
  if (after.pageId !== before.pageId) {
    addMissing(graph, after.entities);
    if (trigger && findEntity(graph, after.pageId)) linkEntities(graph, trigger.id, after.pageId, 'transitionsTo', 'reachedFrom');
  } else {
    change = applyObservedStructuralChange(graph, {
      beforeEntities: before.entities,
      afterEntities: after.entities,
      triggerEntityId: trigger?.id || '',
      ignoredEntityIds: trigger ? [trigger.id] : []
    });
  }

  const output = {
    capturedAt: new Date().toISOString(),
    endpoint,
    before: { pageId: before.pageId, entities: before.entities },
    after: { pageId: after.pageId, entities: after.entities },
    entityGraph: graph,
    structuralChange: change,
    executionTrace: { browserEvents: events, network }
  };

  const dir = path.resolve('data', 'captures');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${timestamp()}.json`);
  await fs.writeFile(file, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n[lemap-web] browser events: ${events.length}`);
  console.log(`[lemap-web] network events: ${network.length}`);
  console.log(`[lemap-web] new entities: ${change.addedEntityIds.length}`);
  console.log(`[lemap-web] state versions: ${change.versionEntityIds.length}`);
  console.log(`[lemap-web] capture written: ${file}`);

  page.off('request', onRequest);
  page.off('response', onResponse);
} catch (error) {
  console.error(`[lemap-web] capture failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
  if (browser) await browser.close();
}
