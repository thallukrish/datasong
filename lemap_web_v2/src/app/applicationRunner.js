import { captureVisibleDom } from '../browser/domScanner.js';
import { enumerateEntityValueDomain } from '../browser/valueDomain.js';
import { createPageEntity } from '../entity/canonicalEntity.js';
import { activeContext } from '../orchestrator/contextStack.js';
import {
  ingestPageVisit,
  refreshCurrentPage,
  completeActiveFrame
} from '../orchestrator/runCoordinator.js';
import { enrichEntitySemantics, chooseNavigationCandidate } from '../semantic/semanticResolver.js';
import {
  selectReusableInput,
  selectNextRequiredInput,
  buildInputQuestion,
  selectNavigationCandidates
} from '../agent/agentDecision.js';
import {
  applyInputValue,
  applyReusableInput,
  executeContinuation
} from '../agent/decisionExecution.js';
import {
  loadEntityGraph,
  loadInstanceGraph,
  loadWorkflow,
  saveEntityGraph,
  saveInstanceGraph,
  saveWorkflow
} from '../storage/persistence.js';
import { createWorkflow } from '../workflow/workflowTraversal.js';

const DEFAULT_DEPS = {
  captureVisibleDom,
  enumerateEntityValueDomain,
  ingestPageVisit,
  refreshCurrentPage,
  completeActiveFrame,
  enrichEntitySemantics,
  chooseNavigationCandidate,
  selectReusableInput,
  selectNextRequiredInput,
  buildInputQuestion,
  selectNavigationCandidates,
  applyInputValue,
  applyReusableInput,
  executeContinuation,
  pageIdForSnapshot: (snapshot) => createPageEntity(snapshot).id
};

async function logEvent(logger, type, data = {}) {
  if (logger?.log) await logger.log(type, data);
}

function requireStorageConfig(config) {
  const storage = config?.storage;
  if (!storage?.entityGraphPath || !storage?.instanceGraphPath || !storage?.workflowLogPath) {
    throw new Error('Storage configuration is required.');
  }
  return storage;
}

export async function loadPersistentRunState({ workflowId, query = '', config, stores = {} } = {}) {
  if (!workflowId) throw new Error('workflowId is required.');
  const storage = requireStorageConfig(config);
  const io = { loadEntityGraph, loadInstanceGraph, loadWorkflow, ...stores };
  const [entityGraph, instanceGraph, existingWorkflow] = await Promise.all([
    io.loadEntityGraph(storage.entityGraphPath),
    io.loadInstanceGraph(storage.instanceGraphPath),
    io.loadWorkflow(storage.workflowLogPath, workflowId)
  ]);
  return {
    entityGraph,
    instanceGraph,
    workflow: existingWorkflow || createWorkflow({ id: workflowId, originalQuestion: query }),
    contextStack: null
  };
}

export async function checkpointRunState(state, config, stores = {}) {
  if (!state?.entityGraph || !state?.instanceGraph || !state?.workflow) throw new Error('A complete run state is required.');
  const storage = requireStorageConfig(config);
  const io = { saveEntityGraph, saveInstanceGraph, saveWorkflow, ...stores };
  await io.saveEntityGraph(storage.entityGraphPath, state.entityGraph);
  await io.saveInstanceGraph(storage.instanceGraphPath, state.instanceGraph);
  await io.saveWorkflow(storage.workflowLogPath, state.workflow);
}

function visibleEntities(state) {
  const frame = state?.contextStack ? activeContext(state.contextStack) : null;
  if (!frame) return [];
  const visible = new Set(frame.visibleEntityIds || []);
  return state.entityGraph.entities.filter((entity) => visible.has(entity.id));
}

function appliedEntityIds(state) {
  const frame = state?.contextStack ? activeContext(state.contextStack) : null;
  return frame?.appliedEntityIds || [];
}

function currentPageEntity(state, frame) {
  return state.entityGraph.entities.find((entity) => entity.id === frame.pageEntityId) || null;
}

function isRootPageFrame(state, frame) {
  return state.contextStack?.frames?.length === 1 && frame?.kind === 'page';
}

function workflowVisitedPageIds(workflow) {
  return new Set((workflow?.steps || []).map((step) => step?.pageEntityId).filter(Boolean));
}

export function filterWorkflowNavigationCandidates(candidates = [], state) {
  const visited = workflowVisitedPageIds(state?.workflow);
  return candidates.filter((entity) => {
    if (entity?.structural?.siteChrome === true) return false;
    const role = String(entity?.semantic?.workflowRole || '').trim().toLowerCase();
    if (['global', 'back', 'informational'].includes(role)) return false;
    const destinations = (entity?.links || [])
      .filter((link) => link.relationship === 'transitionsTo')
      .map((link) => link.id)
      .filter(Boolean);
    if (destinations.length && destinations.every((id) => visited.has(id))) return false;
    return true;
  });
}

async function observeAfterAction({ state, page, triggerEntityId, deps, logger }) {
  const snapshot = await deps.captureVisibleDom(page);
  const frame = activeContext(state.contextStack);
  const nextPageId = deps.pageIdForSnapshot(snapshot);
  await logEvent(logger, 'capture', { pageEntityId: nextPageId, entityId: triggerEntityId || '' });
  if (nextPageId === frame.pageEntityId) {
    return deps.refreshCurrentPage(state, snapshot, { trigger: triggerEntityId ? { entityId: triggerEntityId } : null });
  }
  return deps.ingestPageVisit(state, snapshot, {
    ...(triggerEntityId ? { enteredViaLinkEntityId: triggerEntityId } : {})
  });
}

async function checkpoint(checkpointFn, state) {
  if (typeof checkpointFn === 'function') await checkpointFn(state);
}

async function enrichActiveFrame({ state, gateway, query, deps, logger }) {
  const entities = visibleEntities(state);
  const frame = activeContext(state.contextStack);
  const result = await deps.enrichEntitySemantics({
    graph: state.entityGraph,
    gateway,
    entityIds: entities.map((entity) => entity.id),
    query,
    workflowPages: state.workflow.steps,
    currentPage: currentPageEntity(state, frame)
  });
  await logEvent(logger, 'semantic.enrichment', {
    pageEntityId: frame.pageEntityId,
    frameId: frame.id,
    entityCount: entities.length,
    selectedEntityIds: result?.updatedEntityIds || []
  });
  return visibleEntities(state);
}

async function learnFiniteChoices({ state, page, entity, checkpointFn, deps, logger, frame }) {
  if (entity?.type !== 'ui_control') return;
  if (Array.isArray(entity.structural?.values) && entity.structural.values.length) return;
  const values = await deps.enumerateEntityValueDomain(page, entity, {
    onProbe: (probe) => logEvent(logger, 'input.choices_probe', {
      pageEntityId: frame.pageEntityId,
      frameId: frame.id,
      ...probe
    })
  });
  if (!Array.isArray(values) || !values.length) return;
  entity.structural = { ...(entity.structural || {}), values: [...values] };
  const persisted = state.entityGraph.entities.find((candidate) => candidate.id === entity.id);
  if (persisted && persisted !== entity) persisted.structural = { ...(persisted.structural || {}), values: [...values] };
  await logEvent(logger, 'input.choices', {
    pageEntityId: frame.pageEntityId,
    frameId: frame.id,
    entityId: entity.id,
    entityCount: values.length
  });
  await checkpoint(checkpointFn, state);
}

async function resolveOneInput({ state, page, entities, requestInput, checkpointFn, deps, logger }) {
  const frame = activeContext(state.contextStack);
  const reusable = deps.selectReusableInput({
    entities,
    instanceGraph: state.instanceGraph,
    appliedEntityIds: appliedEntityIds(state),
    visibleEntityIds: frame.visibleEntityIds
  });
  if (reusable) {
    await logEvent(logger, 'input.reuse', { pageEntityId: frame.pageEntityId, frameId: frame.id, entityId: reusable.entity.id });
    await deps.applyReusableInput({ state, page, reusable });
    await observeAfterAction({ state, page, triggerEntityId: reusable.entity.id, deps, logger });
    await checkpoint(checkpointFn, state);
    return true;
  }

  const required = deps.selectNextRequiredInput({
    entities,
    instanceGraph: state.instanceGraph,
    visibleEntityIds: frame.visibleEntityIds
  });
  if (!required) return false;
  if (typeof requestInput !== 'function') throw new Error('requestInput is required when a user value is needed.');

  await logEvent(logger, 'input.required', { pageEntityId: frame.pageEntityId, frameId: frame.id, entityId: required.id });
  await learnFiniteChoices({ state, page, entity: required, checkpointFn, deps, logger, frame });
  const question = deps.buildInputQuestion(required, entities);
  const value = await requestInput(question);
  await deps.applyInputValue({ state, page, entity: required, value });
  await logEvent(logger, 'input.applied', { pageEntityId: frame.pageEntityId, frameId: frame.id, entityId: required.id });
  await observeAfterAction({ state, page, triggerEntityId: required.id, deps, logger });
  await checkpoint(checkpointFn, state);
  return true;
}

async function continuationCandidates({ state, entities, deps }) {
  const frame = activeContext(state.contextStack);
  const candidates = deps.selectNavigationCandidates(entities, {
    visibleEntityIds: frame.visibleEntityIds,
    appliedEntityIds: appliedEntityIds(state)
  });
  return filterWorkflowNavigationCandidates(candidates, state);
}

export async function runApplication({ state, page, query = '', gateway, requestInput, checkpoint: checkpointFn = null, maxSteps = 100, logger = null, deps: overrides = {} } = {}) {
  if (!state?.entityGraph || !state?.instanceGraph || !state?.workflow) throw new Error('A run state is required.');
  if (!page) throw new Error('A browser page is required.');
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) throw new Error('maxSteps must be a positive integer.');
  const deps = { ...DEFAULT_DEPS, ...overrides };

  if (!state.contextStack) {
    const firstSnapshot = await deps.captureVisibleDom(page);
    const pageId = deps.pageIdForSnapshot(firstSnapshot);
    await logEvent(logger, 'capture', { pageEntityId: pageId });
    deps.ingestPageVisit(state, firstSnapshot);
    await checkpoint(checkpointFn, state);
  }

  let workflowSteps = 0;
  while (workflowSteps < maxSteps) {
    const frameBefore = activeContext(state.contextStack);
    const entities = await enrichActiveFrame({ state, gateway, query, deps, logger });
    if (await resolveOneInput({ state, page, entities, requestInput, checkpointFn, deps, logger })) continue;

    const frame = activeContext(state.contextStack);
    const candidates = await continuationCandidates({ state, entities: visibleEntities(state), deps });
    await logEvent(logger, 'navigation.candidates', {
      pageEntityId: frame.pageEntityId,
      frameId: frame.id,
      selectedEntityIds: candidates.map((candidate) => candidate.id),
      entityCount: candidates.length,
      step: workflowSteps
    });

    if (!isRootPageFrame(state, frame)) {
      if (candidates.length) {
        const selected = await deps.chooseNavigationCandidate({
          gateway,
          query,
          workflowPages: state.workflow.steps,
          currentPage: currentPageEntity(state, frame),
          candidates
        });
        if (selected) {
          await logEvent(logger, 'navigation.selected', { pageEntityId: frame.pageEntityId, frameId: frame.id, entityId: selected.id, step: workflowSteps });
          const pageIdBefore = frame.pageEntityId;
          await deps.executeContinuation({ state, page, entity: selected });
          await observeAfterAction({ state, page, triggerEntityId: selected.id, deps, logger });
          await checkpoint(checkpointFn, state);
          if (activeContext(state.contextStack).pageEntityId !== pageIdBefore) workflowSteps += 1;
          continue;
        }
        await logEvent(logger, 'navigation.blocked', { pageEntityId: frame.pageEntityId, frameId: frame.id, step: workflowSteps });
        await checkpoint(checkpointFn, state);
        return { reason: 'blocked', steps: workflowSteps, state };
      }
      deps.completeActiveFrame(state);
      await logEvent(logger, 'frame.pop', { pageEntityId: frame.pageEntityId, frameId: frame.id, step: workflowSteps });
      await checkpoint(checkpointFn, state);
      continue;
    }

    if (candidates.length) {
      const selected = await deps.chooseNavigationCandidate({
        gateway,
        query,
        workflowPages: state.workflow.steps,
        currentPage: currentPageEntity(state, frameBefore),
        candidates
      });
      if (!selected) {
        await logEvent(logger, 'navigation.blocked', { pageEntityId: frame.pageEntityId, frameId: frame.id, step: workflowSteps });
        await checkpoint(checkpointFn, state);
        return { reason: 'blocked', steps: workflowSteps, state };
      }
      await logEvent(logger, 'navigation.selected', { pageEntityId: frame.pageEntityId, frameId: frame.id, entityId: selected.id, step: workflowSteps });
      await deps.executeContinuation({ state, page, entity: selected });
      await observeAfterAction({ state, page, triggerEntityId: selected.id, deps, logger });
      workflowSteps += 1;
      await checkpoint(checkpointFn, state);
      continue;
    }

    await logEvent(logger, 'workflow.completed', { pageEntityId: frame.pageEntityId, frameId: frame.id, completed: true, step: workflowSteps });
    await checkpoint(checkpointFn, state);
    return { reason: 'completed', steps: workflowSteps, state };
  }

  await logEvent(logger, 'workflow.max_steps', { step: workflowSteps });
  return { reason: 'max_steps', steps: workflowSteps, state };
}
