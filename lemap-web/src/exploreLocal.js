import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';
import { choosePage, snapshotPage } from './browserCapture.js';
import { preprocessEntity } from './graph/entityPreprocessor.js';
import { exploreLocalEntity } from './explore/localExplorer.js';
import { collectNavigationCandidates } from './explore/navigationCandidates.js';

const endpoint = process.env.LEMAP_CDP || 'http://127.0.0.1:9222';
const settleMs = Number.isFinite(Number(process.env.LEMAP_SETTLE_MS)) ? Math.max(0, Number(process.env.LEMAP_SETTLE_MS)) : 350;

function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

let browser;
try {
  browser = await chromium.connectOverCDP(endpoint);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = choosePage(pages);
  if (!page) throw new Error('No Chrome tabs found on the CDP connection.');

  console.log(`[lemap-web] attached to ${endpoint}`);
  console.log(`[lemap-web] local exploration: ${await page.title()} :: ${page.url()}`);
  console.log('[lemap-web] policy: automatic radio/checkbox probes only; no button/link navigation will be executed');

  const result = await exploreLocalEntity(page, { settleMs });
  const finalSnapshot = await snapshotPage(page);
  const finalGraph = preprocessEntity(finalSnapshot);
  const outgoingCandidates = await collectNavigationCandidates(page, finalGraph);

  const output = {
    exploredAt: new Date().toISOString(),
    endpoint,
    entity: result.entity,
    initialStateId: result.initialStateId,
    finalStateId: result.finalStateId,
    restored: result.restored,
    observations: result.observations,
    learnedRelationships: result.learnedRelationships,
    outgoingCandidates,
    errors: result.errors
  };

  const dir = path.resolve('data', 'explorations');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${timestamp()}-local.json`);
  await fs.writeFile(file, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n[lemap-web] entity: ${result.entity.label} (${result.entity.id})`);
  console.log(`[lemap-web] observations: ${result.observations.length}`);
  console.log(`[lemap-web] learned relationships: ${result.learnedRelationships.length}`);
  console.log(`[lemap-web] restored initial field state: ${result.restored}`);
  if (result.errors.length) console.log(`[lemap-web] probe errors: ${result.errors.length}`);
  console.log('\n[lemap-web] outgoing candidates (not executed):');
  for (const candidate of outgoingCandidates) {
    console.log(`  - ${candidate.label || '(unlabelled)'} [${candidate.kind}]${candidate.href ? ` -> ${candidate.href}` : ''}`);
  }
  console.log(`\n[lemap-web] exploration written: ${file}`);
} catch (error) {
  console.error(`[lemap-web] local exploration failed: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
