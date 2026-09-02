import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';
import { chromium } from 'playwright-core';
import { preprocessEntity } from './graph/entityPreprocessor.js';
import { projectEntityState } from './graph/entityState.js';
import { computeEntityDelta } from './graph/entityDelta.js';
import { classifyTransition, createWorkflowGraph, recordTransition, serializeWorkflowGraph } from './graph/workflowGraph.js';
import {
  choosePage,
  installUserEventProbe,
  readUserEvents,
  snapshotPage,
  summarizeNetworkEvent
} from './browserCapture.js';

const endpoint = process.env.LEMAP_CDP || 'http://127.0.0.1:9222';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function stateId(state) { return `state:${crypto.createHash('sha1').update(JSON.stringify(state)).digest('hex').slice(0, 12)}`; }
function observedField(graph, event) {
  if (!event) return null;
  const controls = [...(graph.fields || []), ...(graph.actions || [])];
  return controls.find((field) => field.label === event.label || field.name === event.controlName) || null;
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
  const beforeEntity = preprocessEntity(beforeSnapshot);
  const beforeState = projectEntityState(beforeSnapshot, beforeEntity);
  const beforeStateId = stateId(beforeState);
  await installUserEventProbe(page);

  console.log(`[lemap-web] entity: ${beforeEntity.entity.label} (${beforeEntity.entity.id})`);
  console.log(`[lemap-web] fields: ${beforeEntity.fields.length}, actions: ${beforeEntity.actions.length}, groups: ${beforeEntity.groups.length}`);
  await rl.question('\nPerform ONE meaningful action in the attached Chrome tab, wait for the UI to settle, then press Enter here... ');
  await page.waitForTimeout(700);

  const events = await readUserEvents(page);
  const afterSnapshot = await snapshotPage(page);
  const afterEntity = preprocessEntity(afterSnapshot);
  const afterState = projectEntityState(afterSnapshot, afterEntity);
  const afterStateId = stateId(afterState);
  const entityDelta = computeEntityDelta(beforeState, afterState);

  const meaningfulEvent = [...events].reverse().find((event) => ['change', 'click', 'submit', 'input'].includes(event.name)) || null;
  const sourceField = observedField(beforeEntity, meaningfulEvent);
  const evidenceId = `observation:${timestamp()}`;
  const transitionKind = classifyTransition(entityDelta);
  const workflow = createWorkflowGraph('workflow:observed');
  recordTransition(workflow, {
    sourceEntityId: beforeEntity.entity.id,
    targetEntityId: afterEntity.entity.id,
    sourceStateId: beforeStateId,
    targetStateId: afterStateId,
    actionId: sourceField?.id || '',
    kind: transitionKind,
    evidenceIds: [evidenceId],
    delta: entityDelta,
    presentation: {
      source: beforeEntity.entity.presentation,
      target: afterEntity.entity.presentation
    }
  });

  const observation = {
    id: evidenceId,
    entityId: beforeEntity.entity.id,
    fieldId: sourceField?.id || '',
    action: meaningfulEvent ? {
      kind: meaningfulEvent.name,
      label: meaningfulEvent.label,
      controlName: meaningfulEvent.controlName,
      value: meaningfulEvent.value
    } : { kind: 'observed', value: null },
    executionTrace: { browserEvents: events, functions: [], network, callbacks: [], consoleSignals: [] },
    beforeStateId,
    afterStateId,
    result: entityDelta,
    affectedEntityIds: [...new Set([beforeEntity.entity.id, afterEntity.entity.id])]
  };

  const output = {
    capturedAt: new Date().toISOString(),
    endpoint,
    structural: {
      entityBefore: beforeEntity,
      entityAfter: afterEntity,
      stateBefore: beforeState,
      stateAfter: afterState,
      entityDelta,
      workflow: serializeWorkflowGraph(workflow)
    },
    observation
  };

  const dir = path.resolve('data', 'captures');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${timestamp()}.json`);
  await fs.writeFile(file, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n[lemap-web] browser events: ${events.length}`);
  console.log(`[lemap-web] network events: ${network.length}`);
  console.log(`[lemap-web] field value changes: ${entityDelta.fieldValuesChanged.length}`);
  console.log(`[lemap-web] fields enabled: ${entityDelta.fieldsEnabled.length}, disabled: ${entityDelta.fieldsDisabled.length}`);
  console.log(`[lemap-web] actions shown: ${entityDelta.actionsShown.length}, hidden: ${entityDelta.actionsHidden.length}`);
  console.log(`[lemap-web] transition: ${transitionKind}`);
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
