import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';
import { chromium } from 'playwright-core';
import { buildPageStructure, buildWebFlow } from './structuralFlow.js';
import {
  choosePage,
  installUserEventProbe,
  readUserEvents,
  snapshotPage,
  summarizeNetworkEvent
} from './browserCapture.js';

const endpoint = process.env.LEMAP_CDP || 'http://127.0.0.1:9222';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function nearestRegion(pageStructure, label) {
  if (!label) return '';
  const stack = [...(pageStructure.sections || [])];
  while (stack.length) {
    const region = stack.shift();
    if ((region.controls || []).some((control) => control.label === label || control.name === label)) return region.label || '';
    stack.push(...(region.regions || []));
  }
  return '';
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
    const type = request.resourceType();
    if (!['xhr', 'fetch', 'document'].includes(type)) return;
    network.push(summarizeNetworkEvent({ phase: 'request', method: request.method(), url: request.url() }));
  };
  const onResponse = (response) => {
    const request = response.request();
    const type = request.resourceType();
    if (!['xhr', 'fetch', 'document'].includes(type)) return;
    network.push(summarizeNetworkEvent({ phase: 'response', method: request.method(), url: response.url(), status: response.status() }));
  };
  page.on('request', onRequest);
  page.on('response', onResponse);

  const before = await snapshotPage(page);
  const pageStructure = buildPageStructure(before.dom);
  await installUserEventProbe(page);

  console.log(`[lemap-web] initial state captured: ${before.page}`);
  await rl.question('\nPerform ONE meaningful action in the attached Chrome tab, wait for the page to settle, then press Enter here... ');
  await page.waitForTimeout(700);

  const events = await readUserEvents(page);
  const after = await snapshotPage(page);
  const meaningfulEvent = [...events].reverse().find((event) => ['change', 'click', 'submit', 'input'].includes(event.name)) || null;
  const sourceControl = meaningfulEvent?.label || meaningfulEvent?.controlName || '';
  const sourceRegion = nearestRegion(pageStructure, sourceControl);
  const trigger = meaningfulEvent ? {
    kind: meaningfulEvent.name.toUpperCase(),
    value: meaningfulEvent.value,
    label: meaningfulEvent.label,
    controlName: meaningfulEvent.controlName,
    tag: meaningfulEvent.tag
  } : { kind: 'OBSERVED', value: null };

  const flow = buildWebFlow({
    id: `webflow:${timestamp()}`,
    sourceState: before,
    sourceRegion,
    sourceControl,
    trigger,
    execution: [...events, ...network],
    resultState: after
  });

  const output = {
    capturedAt: new Date().toISOString(),
    endpoint,
    pageStructure,
    browserEvents: events,
    network,
    flow
  };

  const dir = path.resolve('data', 'captures');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${timestamp()}.json`);
  await fs.writeFile(file, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n[lemap-web] browser events: ${events.length}`);
  console.log(`[lemap-web] network events: ${network.length}`);
  console.log(`[lemap-web] meaningful state changes: ${flow.effects.length}`);
  for (const effect of flow.effects) console.log(`  - ${effect.kind}:${effect.key}`);
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
