import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { chromium } from 'playwright-core';
import { choosePage } from './browserCapture.js';
import { enumerateEntityValueDomain, exploreReadOnlyEntity } from './explore/readOnlyExplorer.js';
import { buildStructuralEntitiesFromPreprocessed } from './graph/structuralEntityBuilder.js';
import { applyObservedStructuralChange } from './graph/structuralChange.js';
import { findEntity, linkEntities, mergeSemanticPatch, upsertEntity } from './graph/entityGraph.js';
import { upsertInstanceValue } from './graph/instanceGraph.js';
import { loadEntityGraph, loadInstanceGraph, saveEntityGraph, saveInstanceGraph } from './graph/graphStore.js';
import { createRunTransaction, shouldPromoteRun } from './graph/runTransaction.js';
import { entitiesNeedingSemantics, resolveEntitySemantics } from './semantic/entitySemanticResolver.js';
import { setModelCallLogger } from './semantic/modelCall.js';
import { applyEntityValue, executeEntityAction } from './agent/entityBrowserActions.js';
import { waitForStructuralCaptureChange } from './agent/captureSettlement.js';
import { chooseNavigationCandidate } from './agent/navigationDecision.js';
import { planNavigation } from './agent/navigationPlanner.js';
import {
  learningCandidates,
  learningConfigFromEnv,
  newValidationMessages,
  proposalForEntity
} from './agent/learningMode.js';
import {
  buildEntityQuestion,
  ignoredSourceEntityIds,
  resolveEntityAnswer,
  selectNextUserInput,
  selectReusableUserInput
} from './agent/entityFlow.js';
import { createModelClient, modelConfigFromEnv } from './agent/modelClient.js';
import { loadDotEnv } from './agent/env.js';
import { compactModelResult, createRunLogger } from './agent/runLogger.js';

const loadedEnvFiles = await loadDotEnv({ cwd: process.cwd(), env: process.env });
const endpoint = process.env.LEMAP_CDP || 'http://127.0.0.1:9222';
const settleMs = Number.isFinite(Number(process.env.LEMAP_SETTLE_MS)) ? Math.max(0, Number(process.env.LEMAP_SETTLE_MS)) : 500;
const structuralSettleMs = Number.isFinite(Number(process.env.LEMAP_STRUCTURAL_SETTLE_MS)) ? Math.max(0, Number(process.env.LEMAP_STRUCTURAL_SETTLE_MS)) : 10000;
const structuralPollMs = Number.isFinite(Number(process.env.LEMAP_STRUCTURAL_POLL_MS)) ? Math.max(25, Number(process.env.LEMAP_STRUCTURAL_POLL_MS)) : 150;
const maxSteps = Number.isFinite(Number(process.env.LEMAP_MAX_STEPS)) ? Math.max(1, Number(process.env.LEMAP_MAX_STEPS)) : 30;
const entityFile = path.resolve(process.env.LEMAP_ENTITY_GRAPH_FILE || path.join('data', 'entity-graph', 'web-map.json'));
const instanceFile = path.resolve(process.env.LEMAP_INSTANCE_FILE || path.join('data', 'instances', 'default.json'));
const runLogDir = path.resolve(process.env.LEMAP_RUN_LOG_DIR || path.join('data', 'query-runs'));
const learning = learningConfigFromEnv(process.env);

function arr(value) { return Array.isArray(value) ? value : []; }
function hash(value) { return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12); }
function workflowIdForGoal(goal) { return `workflow:${hash(String(goal || '').trim().toLowerCase())}`; }
function actionableControl(entity = {}) {
  return entity.type === 'ui_control' && ['button', 'link'].includes(String(entity.structural?.controlType || ''));
}
function uniqueById(entities = []) {
  const seen = new Set();
  return arr(entities).filter((entity) => entity?.id && !seen.has(entity.id) && seen.add(entity.id));
}
function executionInstances(instances = []) {
  return learning.enabled ? instances : arr(instances).filter((instance) => instance?.mode !== 'learning');
}

async function captureEntities(page) {
  const explored = await exploreReadOnlyEntity(page);
  const built = buildStructuralEntitiesFromPreprocessed(explored.graph);
  return { ...built, explored };
}

async function captureAfterAction(page, before) {
  if (settleMs) await page.waitForTimeout(settleMs);
  const settled = await waitForStructuralCaptureChange({
    before,
    capture: () => captureEntities(page),
    wait: (ms) => page.waitForTimeout(ms),
    timeoutMs: structuralSettleMs,
    pollMs: structuralPollMs
  });
  return settled.capture;
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

async function enrichCurrentSemantics({
  client,
  model,
  userGoal,
  entityGraph,
  currentEntities,
  pageId,
  workflowId,
  instances = [],
  proposedEntityIds = new Set(),
  force = false,
  learningMode = false
}) {
  applyKnownSemantics(currentEntities, entityGraph);

  const workflow = findEntity(entityGraph, workflowId);
  const pageContext = findEntity(entityGraph, pageId);
  const semanticEntities = [workflow, ...currentEntities].filter(Boolean);
  const unresolved = entitiesNeedingSemantics(semanticEntities).filter((entity) => !actionableControl(entity));
  const learnInputs = learningMode ? learningCandidates(semanticEntities, instances, proposedEntityIds) : [];
  const sourceCandidates = force
    ? semanticEntities.filter((entity) => !actionableControl(entity))
    : uniqueById([...unresolved, ...learnInputs]).filter((entity) => !actionableControl(entity));

  if (!sourceCandidates.length) return { called: false, count: 0, result: { entities: [] } };

  const result = await resolveEntitySemantics({
    client,
    model,
    userGoal,
    entities: sourceCandidates,
    pageId,
    pageContext,
    privacyEntities: currentEntities,
    learning: learningMode
  });
  const patched = new Set();
  for (const patch of result.entities) {
    patched.add(patch.id);
    if (findEntity(entityGraph, patch.id)) mergeSemanticPatch(entityGraph, patch.id, patch.semantic);
  }

  for (const entity of unresolved) {
    if (patched.has(entity.id)) continue;
    const fallback = entity.type === 'workflow'
      ? { relevantToGoal: true, complete: false }
      : { interaction: 'unknown', relevantToGoal: false, required: false };
    mergeSemanticPatch(entityGraph, entity.id, fallback);
  }

  applyKnownSemantics(currentEntities, entityGraph);
  return { called: true, count: sourceCandidates.length, result };
}

async function ensureInputOptions(page, entity, entityGraph) {
  if (arr(entity?.structural?.values).length) return entity;
  const values = await enumerateEntityValueDomain(page, entity);
  if (!values.length) return entity;
  entity.structural = { ...entity.structural, values: [...values] };
  const persisted = findEntity(entityGraph, entity.id);
  if (persisted) persisted.structural = { ...persisted.structural, values: [...values] };
  return entity;
}

function printQuestion(question) {
  console.log('');
  if (question.information) console.log(`[LeMap-Web] ${question.information}`);
  for (const caveat of arr(question.caveats)) console.log(`[LeMap-Web] Note: ${caveat}`);
  console.log(`[LeMap-Web] ${question.label}`);
  if (question.instruction) console.log(`[LeMap-Web] ${question.instruction}`);
  if (question.options.length) question.options.forEach((option, index) => console.log(`  ${index + 1}. ${option}`));
  else if (question.examples.length) console.log(`  Examples: ${question.examples.slice(0, 4).join(' • ')}`);
}

async function askUserValue(question, prompt = 'Your answer: ') {
  let value = null;
  while (value === null) {
    const answer = (await rl.question(prompt)).trim();
    value = resolveEntityAnswer(question, answer);
    if (value === null) console.log('[LeMap-Web] Please choose one of the listed values.');
  }
  return value;
}

function displayValue(value) {
  return Array.isArray(value) ? value.join(', ') : String(value ?? '');
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
let stopReason = 'max_steps';
let entityGraph = [];
let instances = [];

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

  const canonicalEntityGraph = await loadEntityGraph(entityFile);
  const canonicalInstances = await loadInstanceGraph(instanceFile);
  const transaction = createRunTransaction(canonicalEntityGraph, canonicalInstances);
  entityGraph = transaction.entityGraph;
  instances = transaction.instanceGraph;

  const workflowId = workflowIdForGoal(userGoal);
  const appliedInstanceEntityIds = new Set();
  const executedContinuationKeys = new Set();
  const recentPageTrail = [];
  const learningProposalCache = new Map();

  browser = await chromium.connectOverCDP(endpoint);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = choosePage(pages);
  if (!page) throw new Error('No Chrome tabs found on the CDP connection.');

  console.log(`[LeMap-Web] goal: ${userGoal}`);
  console.log(`[LeMap-Web] attached: ${await page.title()} :: ${page.url()}`);
  if (loadedEnvFiles.length) console.log(`[LeMap-Web] env: ${loadedEnvFiles.join(', ')}`);
  console.log(`[LeMap-Web] mode: ${learning.mode}${learning.enabled ? ` (${learning.step ? 'single-step' : 'automatic'} learning values)` : ''}`);
  console.log(`[LeMap-Web] entity graph: ${entityFile}`);
  console.log(`[LeMap-Web] instance graph: ${instanceFile}`);
  console.log('[LeMap-Web] learning state: checkpointed unless the run errors or is interrupted');
  console.log(`[LeMap-Web] run log: ${runLogger.file}`);
  await runLogger.write('attached', { title: await page.title(), route: page.url(), model, workflowId, mode: learning.mode });

  let capture = await captureEntities(page);
  addMissingStructuralEntities(entityGraph, capture.entities);
  ensureWorkflowEntity(entityGraph, workflowId, userGoal, capture.pageId);

  for (let step = 1; step <= maxSteps; step += 1) {
    console.log(`\n[LeMap-Web] --- step ${step} ---`);
    applyKnownSemantics(capture.entities, entityGraph);
    const currentPageEntity = capture.entities.find((entity) => entity.id === capture.pageId) || findEntity(entityGraph, capture.pageId);
    if (recentPageTrail.at(-1)?.id !== capture.pageId) {
      recentPageTrail.push({ id: capture.pageId, name: currentPageEntity?.name || capture.pageId });
      if (recentPageTrail.length > 8) recentPageTrail.shift();
    }
    console.log(`[LeMap-Web] page entity: ${currentPageEntity?.name || capture.pageId}`);
    await runLogger.write('step', { step, pageId: capture.pageId, entityCount: capture.entities.length });

    const semanticResult = await enrichCurrentSemantics({
      client,
      model,
      userGoal,
      entityGraph,
      currentEntities: capture.entities,
      pageId: capture.pageId,
      workflowId,
      instances,
      proposedEntityIds: new Set(learningProposalCache.keys()),
      learningMode: learning.enabled,
      force: process.env.LEMAP_REFRESH_KNOWN === '1'
    });
    if (learning.enabled) {
      for (const item of arr(semanticResult.result?.entities)) {
        if (item?.learningAnswer !== undefined && item?.learningAnswer !== null && item?.learningAnswer !== '') {
          learningProposalCache.set(item.id, String(item.learningAnswer));
        }
      }
    }
    if (semanticResult.called) console.log(`[LeMap-Web] semantic additions merged for ${semanticResult.count} unresolved/learning entities`);

    const workflow = findEntity(entityGraph, workflowId);
    if (workflow?.semantic?.complete) {
      stopReason = 'workflow_complete';
      console.log('[LeMap-Web] workflow complete according to semantic entity state.');
      await runLogger.write('stop', { reason: stopReason });
      break;
    }

    const activeInstances = executionInstances(instances);
    const reusable = selectReusableUserInput(capture.entities, activeInstances, appliedInstanceEntityIds);
    if (reusable) {
      console.log(`[LeMap-Web] applying stored instance value for ${reusable.entity.name}`);
      await runLogger.write('instance_apply', { entityId: reusable.entity.id, source: 'stored', mode: reusable.instance.mode || 'run' });
      const before = capture;
      await applyEntityValue(page, capture.entities, reusable.entity, reusable.instance.value);
      const after = await captureAfterAction(page, before);

      if (after.pageId !== before.pageId) {
        appliedInstanceEntityIds.clear();
        contextTransition(entityGraph, workflowId, reusable.entity.id, after);
      } else {
        appliedInstanceEntityIds.add(reusable.entity.id);
        applyObservedStructuralChange(entityGraph, {
          beforeEntities: before.entities,
          afterEntities: after.entities,
          triggerEntityId: reusable.entity.id,
          ignoredEntityIds: ignoredSourceEntityIds(reusable.entity)
        });
      }
      addMissingStructuralEntities(entityGraph, after.entities);
      capture = after;
      continue;
    }

    const input = selectNextUserInput(capture.entities, activeInstances);
    if (input) {
      await ensureInputOptions(page, input, entityGraph);
      const question = buildEntityQuestion(input, capture.entities);
      printQuestion(question);

      let value = null;
      let valueSource = 'user';
      const proposed = learning.enabled
        ? learningProposalCache.get(input.id) ?? proposalForEntity(semanticResult.result, input.id)
        : null;
      if (proposed !== null) {
        const proposedValue = resolveEntityAnswer(question, proposed);
        if (proposedValue !== null) {
          console.log(`[LeMap-Web] model learning value: ${displayValue(proposedValue)}`);
          let approved = true;
          if (learning.step) {
            const answer = (await rl.question('Apply model value? [Y/n] ')).trim();
            approved = !/^n(o)?$/i.test(answer);
          }
          if (approved) {
            value = proposedValue;
            valueSource = 'model';
          }
        } else {
          console.log('[LeMap-Web] model learning value did not match the current field/options; asking user.');
          await runLogger.write('learning_value_rejected', { entityId: input.id, reason: 'invalid_proposal' });
        }
      }
      if (value === null) value = await askUserValue(question);

      let before = capture;
      let after;
      try {
        await applyEntityValue(page, capture.entities, input, value);
        after = await captureAfterAction(page, before);
      } catch (error) {
        if (!(learning.enabled && valueSource === 'model')) throw error;
        console.log('[LeMap-Web] model learning value could not be applied; please provide this value.');
        await runLogger.write('learning_value_rejected', { entityId: input.id, reason: 'apply_error' });
        value = await askUserValue(question);
        valueSource = 'user';
        await applyEntityValue(page, capture.entities, input, value);
        after = await captureAfterAction(page, before);
      }

      const validationFailures = learning.enabled && valueSource === 'model' ? newValidationMessages(before, after) : [];
      if (validationFailures.length) {
        console.log('[LeMap-Web] model learning value was rejected by page validation; please provide this value.');
        await runLogger.write('learning_value_rejected', { entityId: input.id, reason: 'validation', count: validationFailures.length });
        const currentInput = after.entities.find((entity) => entity.id === input.id) || input;
        const manualQuestion = buildEntityQuestion(currentInput, after.entities);
        printQuestion(manualQuestion);
        value = await askUserValue(manualQuestion);
        valueSource = 'user';
        before = after;
        await applyEntityValue(page, after.entities, currentInput, value);
        after = await captureAfterAction(page, before);
      }

      upsertInstanceValue(
        instances,
        input.id,
        value,
        learning.enabled ? { mode: 'learning', source: valueSource } : {}
      );
      learningProposalCache.delete(input.id);
      await runLogger.write('instance_write', {
        entityId: input.id,
        value: 'provisional',
        ...(learning.enabled ? { mode: 'learning', source: valueSource } : {})
      });

      if (after.pageId !== before.pageId) {
        appliedInstanceEntityIds.clear();
        contextTransition(entityGraph, workflowId, input.id, after);
      } else {
        appliedInstanceEntityIds.add(input.id);
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
      capture = after;
      continue;
    }

    const blockedEntityIds = new Set(
      capture.entities
        .filter((entity) => executedContinuationKeys.has(`${capture.pageId}|${entity.id}`))
        .map((entity) => entity.id)
    );
    const pageContext = capture.entities.find((entity) => entity.id === capture.pageId) || findEntity(entityGraph, capture.pageId);
    const navigation = await planNavigation({
      entityGraph,
      currentEntities: capture.entities,
      currentPageId: capture.pageId,
      recentPageTrail,
      blockedEntityIds,
      choose: ({ candidates }) => chooseNavigationCandidate({ client, model, userGoal, candidates, pageContext, recentPageTrail, privacyEntities: capture.entities })
    });
    if (navigation.topologyCount) console.log(`[LeMap-Web] topology filtered/resolved ${navigation.topologyCount} navigation entities without the model`);
    const continuation = navigation.entity;
    if (!continuation) {
      stopReason = 'no_executable_entity';
      console.log('[LeMap-Web] no unresolved clickable action can currently continue the workflow.');
      await runLogger.write('stop', { reason: stopReason });
      break;
    }

    executedContinuationKeys.add(`${capture.pageId}|${continuation.id}`);
    console.log(`[LeMap-Web] continuing via: ${continuation.name} [${navigation.source}]`);
    await runLogger.write('navigation_choice', { pageId: capture.pageId, entityId: continuation.id, source: navigation.source });
    const before = capture;
    const execution = await executeEntityAction(page, continuation);
    if (execution?.executed === false && execution.reason === 'locator_miss') {
      console.log(`[LeMap-Web] continuation locator became stale; skipping ${continuation.name} and trying the next candidate.`);
      await runLogger.write('continuation_skip', { entityId: continuation.id, reason: execution.reason, pageId: capture.pageId });
      capture = await captureEntities(page);
      addMissingStructuralEntities(entityGraph, capture.entities);
      continue;
    }
    const after = await captureAfterAction(page, before);

    if (after.pageId !== before.pageId) {
      appliedInstanceEntityIds.clear();
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
        stopReason = 'continuation_no_structural_change';
        console.log('[LeMap-Web] continuation produced no new structural state; stopping to avoid a loop.');
        await runLogger.write('stop', { reason: stopReason });
        break;
      }
      await runLogger.write('structural_change', change);
    }

    addMissingStructuralEntities(entityGraph, after.entities);
    capture = after;
  }

  const promoted = shouldPromoteRun(stopReason);
  if (promoted) {
    await saveEntityGraph(entityFile, entityGraph);
    await saveInstanceGraph(instanceFile, instances);
    console.log(`[LeMap-Web] run learning promoted to canonical graph (${stopReason}).`);
  } else {
    console.log(`[LeMap-Web] run learning discarded; canonical graph unchanged (${stopReason}).`);
  }
  await runLogger.write('run_state', { state: promoted ? 'promoted' : 'discarded', reason: stopReason });

  const tokenSummary = runLogger.tokenSummary();
  printTokenSummary(tokenSummary);
  await runLogger.write('token_summary', tokenSummary);
  tokenSummaryWritten = true;
  await runLogger.write('run_end', { status: promoted ? 'promoted' : 'discarded', reason: stopReason });
} catch (error) {
  stopReason = 'error';
  console.error(`[LeMap-Web] query agent failed: ${error.stack || error.message}`);
  await runLogger?.write('error', { message: String(error.message || error).slice(0, 600), stack: String(error.stack || '').split('\n').slice(0, 5).join('\n') });
  await runLogger?.write('run_state', { state: 'discarded', reason: stopReason });
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
