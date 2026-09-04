import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { chromium } from 'playwright-core';
import { choosePage } from './browserCapture.js';
import { exploreReadOnlyEntity } from './explore/readOnlyExplorer.js';
import { buildStructuralEntitiesFromPreprocessed } from './graph/structuralEntityBuilder.js';
import { applyObservedStructuralChange } from './graph/structuralChange.js';
import { findEntity, linkEntities, mergeSemanticPatch, upsertEntity } from './graph/entityGraph.js';
import { instanceForEntity, upsertInstanceValue } from './graph/instanceGraph.js';
import { loadEntityGraph, loadInstanceGraph, saveEntityGraph, saveInstanceGraph } from './graph/graphStore.js';
import { resolveEntitySemantics } from './semantic/entitySemanticResolver.js';
import { setModelCallLogger } from './semantic/modelCall.js';
import { applyEntityValue, executeEntityAction } from './agent/entityBrowserActions.js';
import {
  buildEntityQuestion,
  ignoredSourceEntityIds,
  resolveEntityAnswer,
  selectNextUserInput,
  selectWorkflowContinuation
} from './agent/entityFlow.js';
import { createModelClient, modelConfigFromEnv } from './agent/modelClient.js';
import { loadDotEnv } from './agent/env.js';
import { compactModelResult, createRunLogger } from './agent/runLogger.js';

const loadedEnvFiles = await loadDotEnv({ cwd: process.cwd(), env: process.env });
const endpoint = process.env.LEMAP_CDP || 'http://127.0.0.1:9222';
const settleMs = Number.isFinite(Number(process.env.LEMAP_SETTLE_MS)) ? Math.max(0, Number(process.env.LEMAP_SETTLE_MS)) : 500;
const maxSteps = Number.isFinite(Number(process.env.LEMAP_MAX_STEPS)) ? Math.max(1, Number(process.env.LEMAP_MAX_STEPS)) : 30;
const entityFile = path.resolve(process.env.LEMAP_ENTITY_GRAPH_FILE || process.env.LEMAP_MEMORY_FILE || path.join('data', 'entity-graph', 'web-map.json'));
const instanceFile = path.resolve(process.env.LEMAP_INSTANCE_FILE || path.join('data', 'instances', 'default.json'));
const runLogDir = path.resolve(process.env.LEMAP_RUN_LOG_DIR || path.join('data', 'query-runs'));

function arr(value) { return Array.isArray(value) ? value : []; }
function hash(value) { return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12); }
function workflowIdForGoal(goal) { return `workflow:${hash(String(goal || '').trim().toLowerCase())}`; }
function hasSemantic(entity = {}) { return Object.keys(entity.semantic || {}).length > 0; }
function normalized(value) { return String(value ?? '').trim().toLowerCase(); }

async function captureEntities(page) {
  const explored = await exploreReadOnlyEntity(page);
  const built = buildStructuralEntitiesFromPreprocessed(explored.graph);
  return { ...built, explored };
}

function addMissingStructuralEntities(entityGraph, currentEntities) {
  const added = [];
  for (const entity of arr(currentEntities)) {
    if (findEntity(entityGraph, entity.id)) continue;
    upsertEntity(entityGraph, entity);
    added.push(entity.id);
  }
  return added;
}

function applyKnownSemantics(currentEntities, entityGraph) {
  for (const current of arr(currentEntities)) {
    const known = findEntity(entityGraph, current.id);
    if (known?.semantic) current.semantic = structuredClone(known.semantic);
  }
  return currentEntities;
}

function ensureWorkflowEntity(entityGraph, workflowId, goal, pageId) {
  if (!findEntity(entityGraph, workflowId)) {
    upsertEntity(entityGraph, {
      id: workflowId,
      name: String(goal || 'Workflow'),
      type: 'workflow',
      structural: { goal: String(goal || '') },
      semantic: {},
      links: []
    });
  }
  if (pageId && findEntity(entityGraph, pageId)) {
    linkEntities(entityGraph, workflowId, pageId, 'contains', 'partOfWorkflow');
  }
  return findEntity(entityGraph, workflowId);
}

async function enrichCurrentSemantics({ client, model, userGoal, entityGraph, currentEntities, pageId, workflowId, force = false }) {
  applyKnownSemantics(currentEntities, entityGraph);
  const unresolved = currentEntities.filter((entity) => !hasSemantic(findEntity(entityGraph, entity.id)));
  if (!force && !unresolved.length) return { called: false, workflowComplete: !!findEntity(entityGraph, workflowId)?.semantic?.complete };

  const workflow = findEntity(entityGraph, workflowId);
  const result = await resolveEntitySemantics({
    client,
    model,
    userGoal,
    entities: currentEntities,
    pageId,
    knownWorkflow: workflow ? { id: workflow.id, name: workflow.name, semantic: workflow.semantic || {} } : null
  });
  const patched = new Set();
  for (const patch of result.entities) {
    patched.add(patch.id);
    if (findEntity(entityGraph, patch.id)) mergeSemanticPatch(entityGraph, patch.id, patch.semantic);
  }

  for (const entity of unresolved) {
    if (patched.has(entity.id)) continue;
    mergeSemanticPatch(entityGraph, entity.id, {
      interaction: 'unknown',
      relevantToGoal: false,
      required: false,
      workflowRole: 'unknown'
    });
  }

  if (result.workflow && workflow) {
    workflow.semantic = {
      ...workflow.semantic,
      name: result.workflow.name || workflow.semantic?.name || '',
      description: result.workflow.description || workflow.semantic?.description || '',
      complete: !!result.workflow.complete
    };
  }
  applyKnownSemantics(currentEntities, entityGraph);
  return { called: true, workflowComplete: !!workflow?.semantic?.complete };
}

function printQuestion(question) {
  console.log('');
  if (question.information) console.log(`[LeMap-Web] ${question.information}`);
  for (const caveat of arr(question.caveats)) console.log(`[LeMap-Web] Note: ${caveat}`);
  console.log(`[LeMap-Web] ${question.label}`);
  if (question.options.length) question.options.forEach((option, index) => console.log(`  ${index + 1}. ${option}`));
  else if (question.examples.length) console.log(`  Examples: ${question.examples.slice(0, 4).join(' • ')}`);
}

function currentValueMatches(entity, value) {
  const structural = entity.structural || {};
  if (entity.type === 'group') return normalized(structural.value) === normalized(value);
  if (structural.controlType === 'checkbox') return !!structural.checked === !!value;
  if (structural.controlType === 'radio') return structural.checked === true;
  if (structural.value === null || structural.value === undefined || structural.value === '') return false;
  return normalized(structural.value) === normalized(value);
}

function reusableInput(currentEntities, instances) {
  return currentEntities.find((entity) => {
    const semantic = entity.semantic || {};
    if (semantic.interaction !== 'user_input' || semantic.relevantToGoal !== true || semantic.required !== true) return false;
    if (entity.structural?.visible === false || entity.structural?.disabled === true) return false;
    const instance = instanceForEntity(instances, entity.id);
    return !!instance && !currentValueMatches(entity, instance.value);
  }) || null;
}

function contextTransition(entityGraph, workflowId, triggerId, afterCapture) {
  addMissingStructuralEntities(entityGraph, afterCapture.entities);
  ensureWorkflowEntity(entityGraph, workflowId, findEntity(entityGraph, workflowId)?.structural?.goal || '', afterCapture.pageId);
  if (triggerId && findEntity(entityGraph, triggerId) && findEntity(entityGraph, afterCapture.pageId)) {
    linkEntities(entityGraph, triggerId, afterCapture.pageId, 'transitionsTo', 'reachedFrom');
  }
}

function modelConsoleLine(summary = {}) {
  const tokens = summary.tokens || {};
  const total = tokens.total ?? '?';
  return `[model] ${summary.purpose}  ${total} tok  ${summary.durationMs}ms`;
}

function printTokenSummary(summary = {}) {
  const purposes = Object.entries(summary.byPurpose || {});
  if (!purposes.length) return;
  console.log('\n[LeMap-Web] model token usage:');
  for (const [purpose, usage] of purposes) console.log(`  ${purpose}: ${usage.calls} calls, ${usage.tokens} tok${usage.cacheHit ? `, cache ${usage.cacheHit}` : ''}`);
  console.log(`  total: ${summary.total.calls} calls, ${summary.total.tokens} tok${summary.total.cacheHit ? `, cache ${summary.total.cacheHit}` : ''}`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let browser;
let runLogger = null;
let tokenSummaryWritten = false;

try {
  let userGoal = process.argv.slice(2).join(' ').trim();
  if (!userGoal) userGoal = (await rl.question('What do you want to do? ')).trim();
  if (!userGoal) throw new Error('A user goal is required.');

  runLogger = await createRunLogger({ baseDir: runLogDir, goal: userGoal });
  const config = modelConfigFromEnv();
  const client = createModelClient(config);
  const model = config.model;
  setModelCallLogger(async (event) => {
    if (event.error) {
      console.log(`[model] ${event.purpose}  ${event.durationMs}ms  → ERROR ${event.error}`);
      await runLogger.write('model_error', { purpose: event.purpose, model: event.model, durationMs: event.durationMs, error: String(event.error).slice(0, 400) });
      return;
    }
    const summary = compactModelResult(event);
    console.log(modelConsoleLine(summary));
    await runLogger.recordModel(summary);
  });

  const entityGraph = await loadEntityGraph(entityFile);
  const instances = await loadInstanceGraph(instanceFile);
  const workflowId = workflowIdForGoal(userGoal);

  browser = await chromium.connectOverCDP(endpoint);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = choosePage(pages);
  if (!page) throw new Error('No Chrome tabs found on the CDP connection.');

  console.log(`[LeMap-Web] goal: ${userGoal}`);
  console.log(`[LeMap-Web] attached: ${await page.title()} :: ${page.url()}`);
  if (loadedEnvFiles.length) console.log(`[LeMap-Web] env: ${loadedEnvFiles.join(', ')}`);
  console.log(`[LeMap-Web] entity graph: ${entityFile}`);
  console.log(`[LeMap-Web] instance graph: ${instanceFile}`);
  console.log(`[LeMap-Web] run log: ${runLogger.file}`);
  await runLogger.write('attached', { title: await page.title(), route: page.url(), model, workflowId });

  let capture = await captureEntities(page);
  addMissingStructuralEntities(entityGraph, capture.entities);
  ensureWorkflowEntity(entityGraph, workflowId, userGoal, capture.pageId);
  await saveEntityGraph(entityFile, entityGraph);

  for (let step = 1; step <= maxSteps; step += 1) {
    console.log(`\n[LeMap-Web] --- step ${step} ---`);
    applyKnownSemantics(capture.entities, entityGraph);
    console.log(`[LeMap-Web] page entity: ${findEntity(entityGraph, capture.pageId)?.name || capture.pageId}`);
    await runLogger.write('step', { step, pageId: capture.pageId, entityCount: capture.entities.length });

    const semanticResult = await enrichCurrentSemantics({
      client,
      model,
      userGoal,
      entityGraph,
      currentEntities: capture.entities,
      pageId: capture.pageId,
      workflowId,
      force: process.env.LEMAP_REFRESH_KNOWN === '1'
    });
    await saveEntityGraph(entityFile, entityGraph);
    if (semanticResult.called) console.log('[LeMap-Web] semantic additions merged into entity graph');

    const workflow = findEntity(entityGraph, workflowId);
    if (workflow?.semantic?.complete) {
      console.log('[LeMap-Web] workflow complete according to semantic entity state.');
      await runLogger.write('stop', { reason: 'workflow_complete' });
      break;
    }

    const reused = reusableInput(capture.entities, instances);
    if (reused) {
      const instance = instanceForEntity(instances, reused.id);
      console.log(`[LeMap-Web] applying stored instance value for ${reused.name}`);
      const before = capture;
      await applyEntityValue(page, capture.entities, reused, instance.value);
      if (settleMs) await page.waitForTimeout(settleMs);
      const after = await captureEntities(page);

      if (after.pageId !== before.pageId) {
        contextTransition(entityGraph, workflowId, reused.id, after);
      } else {
        applyObservedStructuralChange(entityGraph, {
          beforeEntities: before.entities,
          afterEntities: after.entities,
          triggerEntityId: reused.id,
          ignoredEntityIds: ignoredSourceEntityIds(reused)
        });
      }
      addMissingStructuralEntities(entityGraph, after.entities);
      await saveEntityGraph(entityFile, entityGraph);
      capture = after;
      continue;
    }

    const input = selectNextUserInput(capture.entities, instances);
    if (input) {
      const question = buildEntityQuestion(input, capture.entities);
      printQuestion(question);
      let value = null;
      while (value === null) {
        const answer = (await rl.question('Your answer: ')).trim();
        value = resolveEntityAnswer(question, answer);
        if (value === null) console.log('[LeMap-Web] Please choose one of the listed values.');
      }

      upsertInstanceValue(instances, input.id, value);
      await saveInstanceGraph(instanceFile, instances);
      await runLogger.write('instance_write', { entityId: input.id, value: 'stored' });

      const before = capture;
      await applyEntityValue(page, capture.entities, input, value);
      if (settleMs) await page.waitForTimeout(settleMs);
      const after = await captureEntities(page);

      if (after.pageId !== before.pageId) {
        contextTransition(entityGraph, workflowId, input.id, after);
      } else {
        const change = applyObservedStructuralChange(entityGraph, {
          beforeEntities: before.entities,
          afterEntities: after.entities,
          triggerEntityId: input.id,
          ignoredEntityIds: ignoredSourceEntityIds(input)
        });
        if (change.addedEntityIds.length || change.versionEntityIds.length) {
          console.log(`[LeMap-Web] structural graph extended: +${change.addedEntityIds.length} entities, +${change.versionEntityIds.length} state versions`);
          await runLogger.write('structural_change', change);
        }
      }
      addMissingStructuralEntities(entityGraph, after.entities);
      await saveEntityGraph(entityFile, entityGraph);
      capture = after;
      continue;
    }

    const continuation = selectWorkflowContinuation(capture.entities);
    if (!continuation) {
      console.log('[LeMap-Web] no goal-relevant executable user input or safe workflow continuation is currently known.');
      await runLogger.write('stop', { reason: 'no_executable_entity' });
      break;
    }

    console.log(`[LeMap-Web] continuing via: ${continuation.name}`);
    const before = capture;
    await executeEntityAction(page, continuation);
    if (settleMs) await page.waitForTimeout(settleMs);
    const after = await captureEntities(page);

    if (after.pageId !== before.pageId) {
      contextTransition(entityGraph, workflowId, continuation.id, after);
      console.log(`[LeMap-Web] transition: ${before.pageId} -> ${after.pageId}`);
      await runLogger.write('transition', { sourcePageId: before.pageId, actionEntityId: continuation.id, targetPageId: after.pageId });
    } else {
      const change = applyObservedStructuralChange(entityGraph, {
        beforeEntities: before.entities,
        afterEntities: after.entities,
        triggerEntityId: continuation.id,
        ignoredEntityIds: [continuation.id]
      });
      if (!change.addedEntityIds.length && !change.versionEntityIds.length) {
        console.log('[LeMap-Web] continuation produced no new structural state; stopping to avoid a loop.');
        await runLogger.write('stop', { reason: 'continuation_no_structural_change' });
        break;
      }
    }

    addMissingStructuralEntities(entityGraph, after.entities);
    await saveEntityGraph(entityFile, entityGraph);
    capture = after;
  }

  const tokenSummary = runLogger.tokenSummary();
  printTokenSummary(tokenSummary);
  await runLogger.write('token_summary', tokenSummary);
  tokenSummaryWritten = true;
  await runLogger.write('run_end', { status: 'completed_or_stopped' });
} catch (error) {
  console.error(`[LeMap-Web] query agent failed: ${error.stack || error.message}`);
  await runLogger?.write('error', { message: String(error.message || error).slice(0, 600), stack: String(error.stack || '').split('\n').slice(0, 5).join('\n') });
  if (runLogger && !tokenSummaryWritten) {
    const tokenSummary = runLogger.tokenSummary();
    printTokenSummary(tokenSummary);
    await runLogger.write('token_summary', tokenSummary);
    tokenSummaryWritten = true;
  }
  process.exitCode = 1;
} finally {
  setModelCallLogger(null);
  rl.close();
  if (browser) await browser.close();
}
