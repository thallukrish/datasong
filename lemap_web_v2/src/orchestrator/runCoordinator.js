import { orchestratePage } from './pageOrchestrator.js';
import { buildPageHierarchy } from './pageHierarchy.js';
import { inferLogicalGroups } from './logicalGroups.js';
import { mergePageVisit } from './pageReuse.js';
import { reconcileVisibleState } from './graphReconciler.js';
import {
  createFrame,
  createContextStack,
  activeContext,
  updateActiveContext
} from './contextStack.js';
import { createEntityGraph } from '../graph/entityGraph.js';
import { createInstanceGraph } from '../graph/instanceGraph.js';
import { createWorkflow, appendWorkflowStep } from '../workflow/workflowTraversal.js';

function materializeSnapshot(snapshot, options = {}) {
  const orchestrated = orchestratePage(snapshot, options);
  const hierarchy = buildPageHierarchy(orchestrated);
  return inferLogicalGroups({
    page: hierarchy.page,
    entities: hierarchy.entities
  });
}

function visibleIds(entities = []) {
  return [...new Set(entities.map((entity) => entity?.id).filter(Boolean))];
}

export function createRunState({ workflowId = '', originalQuestion = '' } = {}) {
  if (!workflowId) throw new Error('workflowId is required.');
  return {
    entityGraph: createEntityGraph(),
    instanceGraph: createInstanceGraph(),
    workflow: createWorkflow({ id: workflowId, originalQuestion }),
    contextStack: null
  };
}

export function ingestPageVisit(state, snapshot, {
  enteredViaLinkEntityId,
  registry
} = {}) {
  if (!state?.entityGraph || !state?.workflow) throw new Error('A run state is required.');

  const learned = materializeSnapshot(snapshot, registry ? { registry } : {});
  const merged = mergePageVisit({
    graph: state.entityGraph,
    page: learned.page,
    entities: learned.entities
  });

  const frame = createFrame({
    kind: 'page',
    contextEntityId: learned.page.id,
    pageEntityId: learned.page.id,
    visibleEntityIds: visibleIds(learned.entities)
  });
  state.contextStack = createContextStack(frame);

  appendWorkflowStep(state.workflow, {
    pageEntityId: learned.page.id,
    ...(enteredViaLinkEntityId !== undefined ? { enteredViaLinkEntityId } : {}),
    frameId: frame.id
  });

  return {
    ...merged,
    frameId: frame.id,
    visibleEntityIds: [...frame.visibleEntityIds]
  };
}

export function refreshCurrentPage(state, snapshot, {
  trigger = null,
  registry
} = {}) {
  if (!state?.contextStack) throw new Error('A current page context is required.');

  const frame = activeContext(state.contextStack);
  const learned = materializeSnapshot(snapshot, registry ? { registry } : {});
  if (learned.page.id !== frame.pageEntityId) {
    throw new Error(`Page changed during refresh: ${frame.pageEntityId} -> ${learned.page.id}`);
  }

  const reconciled = reconcileVisibleState({
    graph: state.entityGraph,
    currentEntities: learned.entities,
    previousVisibleEntityIds: frame.visibleEntityIds,
    trigger
  });

  updateActiveContext(state.contextStack, {
    visibleEntityIds: reconciled.visibleEntityIds,
    activeDynamicBranchIds: reconciled.revealedRootIds
  });

  return {
    ...reconciled,
    pageEntityId: learned.page.id,
    frameId: frame.id
  };
}
