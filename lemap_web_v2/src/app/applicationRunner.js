import { captureVisibleDom } from '../browser/domScanner.js';
import { createPageEntity } from '../entity/canonicalEntity.js';
import { activeContext } from '../orchestrator/contextStack.js';
import { ingestPageVisit, refreshCurrentPage } from '../orchestrator/runCoordinator.js';
import { enrichEntitySemantics, chooseNavigationCandidate } from '../semantic/semanticResolver.js';
import {
  selectReusableInput,
  selectNextRequiredInput,
  buildInputQuestion,
  selectNavigationCandidates,
  workflowComplete
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
  ingestPageVisit,
  refreshCurrentPage,
  enrichEntitySemantics,
  chooseNavigationCandidate,
  selectReusableInput,
  selectNextRequiredInput,
  buildInputQuestion,
  selectNavigationCandidates,
  workflowComplete,
  applyInputValue,
  applyReusableInput,
  executeContinuation,
  pageIdForSnapshot: (snapshot) => createPageEntity(snapshot).id
};

function requireStorageConfig(config) {
  const storage = config?.storage;
  if (!storage?.entityGraphPath || !storage?.instanceGraphPath || !storage?.workflowLogPath) {
    throw new Error('Storage configuration is required.');
  }
  return storage;
}

export async function loadPersistentRunState({
  workflowId,
  query = '',
  config,
  stores = {}
} = {}) {
  if (!workflowId) throw new Error('workflowId is required.');
  const storage = requireStorageConfig(config);
  const io = {
    loadEntityGraph,
    loadInstanceGraph,
    loadWorkflow,
    ...stores
  };

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
  if (!state?.entityGraph || !state?.instanceGraph || !state?.workflow) {
    throw new Error('A complete run state is required.');
  }
  const storage = requireStorageConfig(config);
  const io = {
    saveEntityGraph,
    saveInstanceGraph,
    saveWorkflow,
    ...stores
  };

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

async function observeAfterAction({
  state,
  page,
  triggerEntityId,
  deps
}) {
  const snapshot = await deps.captureVisibleDom(page);
  const frame = activeContext(state.contextStack);
  const nextPageId = deps.pageIdForSnapshot(snapshot);

  if (nextPageId === frame.pageEntityId) {
    return deps.refreshCurrentPage(state, snapshot, {
      trigger: triggerEntityId ? { entityId: triggerEntityId } : null
    });
  }

  return deps.ingestPageVisit(state, snapshot, {
    ...(triggerEntityId ? { enteredViaLinkEntityId: triggerEntityId } : {})
  });
}

async function checkpoint(checkpointFn, state) {
  if (typeof checkpointFn === 'function') await checkpointFn(state);
}

export async function runApplication({
  state,
  page,
  query = '',
  gateway,
  requestInput,
  checkpoint: checkpointFn = null,
  maxSteps = 100,
  deps: overrides = {}
} = {}) {
  if (!state?.entityGraph || !state?.instanceGraph || !state?.workflow) {
    throw new Error('A run state is required.');
  }
  if (!page) throw new Error('A browser page is required.');
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) throw new Error('maxSteps must be a positive integer.');

  const deps = { ...DEFAULT_DEPS, ...overrides };

  if (!state.contextStack) {
    const firstSnapshot = await deps.captureVisibleDom(page);
    deps.ingestPageVisit(state, firstSnapshot);
    await checkpoint(checkpointFn, state);
  }

  for (let step = 1; step <= maxSteps; step += 1) {
    let entities = visibleEntities(state);
    const frame = activeContext(state.contextStack);

    await deps.enrichEntitySemantics({
      graph: state.entityGraph,
      gateway,
      entityIds: entities.map((entity) => entity.id),
      query,
      workflowPages: state.workflow.steps,
      currentPage: state.entityGraph.entities.find((entity) => entity.id === frame.pageEntityId) || null
    });

    entities = visibleEntities(state);

    const reusable = deps.selectReusableInput({
      entities,
      instanceGraph: state.instanceGraph,
      appliedEntityIds: appliedEntityIds(state),
      visibleEntityIds: frame.visibleEntityIds
    });
    if (reusable) {
      await deps.applyReusableInput({ state, page, reusable });
      await observeAfterAction({ state, page, triggerEntityId: reusable.entity.id, deps });
      await checkpoint(checkpointFn, state);
      continue;
    }

    const required = deps.selectNextRequiredInput({
      entities,
      instanceGraph: state.instanceGraph,
      visibleEntityIds: frame.visibleEntityIds
    });
    if (required) {
      if (typeof requestInput !== 'function') {
        throw new Error('requestInput is required when a user value is needed.');
      }
      const question = deps.buildInputQuestion(required, entities);
      const value = await requestInput(question);
      await deps.applyInputValue({ state, page, entity: required, value });
      await observeAfterAction({ state, page, triggerEntityId: required.id, deps });
      await checkpoint(checkpointFn, state);
      continue;
    }

    const navigationCandidates = deps.selectNavigationCandidates(entities, {
      visibleEntityIds: frame.visibleEntityIds
    });
    if (navigationCandidates.length) {
      const selected = await deps.chooseNavigationCandidate({
        gateway,
        query,
        workflowPages: state.workflow.steps,
        currentPage: state.entityGraph.entities.find((entity) => entity.id === frame.pageEntityId) || null,
        candidates: navigationCandidates
      });
      if (selected) {
        await deps.executeContinuation({ state, page, entity: selected });
        await observeAfterAction({ state, page, triggerEntityId: selected.id, deps });
        await checkpoint(checkpointFn, state);
        continue;
      }
    }

    if (deps.workflowComplete({
      entities,
      instanceGraph: state.instanceGraph,
      visibleEntityIds: frame.visibleEntityIds
    })) {
      await checkpoint(checkpointFn, state);
      return { reason: 'completed', steps: step - 1, state };
    }

    await checkpoint(checkpointFn, state);
    return { reason: 'blocked', steps: step - 1, state };
  }

  return { reason: 'max_steps', steps: maxSteps, state };
}
