import { orchestratePage } from './pageOrchestrator.js';
import { buildPageHierarchy } from './pageHierarchy.js';
import { inferLogicalGroups } from './logicalGroups.js';
import { mergePageVisit } from './pageReuse.js';
import { reconcileVisibleState } from './graphReconciler.js';
import {
  createFrame,
  createContextStack,
  activeContext,
  pushContext,
  popContext
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

function rootFrame(stack) {
  if (!stack?.frames?.length) throw new Error('A non-empty context stack is required.');
  return stack.frames[0];
}

function containedIds(graph, rootIds = [], visibleEntityIds = []) {
  const visible = new Set(visibleEntityIds);
  const byId = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const found = new Set();
  const queue = [...rootIds].filter((id) => visible.has(id));

  while (queue.length) {
    const id = queue.shift();
    if (found.has(id)) continue;
    found.add(id);
    const entity = byId.get(id);
    for (const link of entity?.links || []) {
      if (link.relationship === 'contains' && visible.has(link.id) && !found.has(link.id)) {
        queue.push(link.id);
      }
    }
  }

  return [...found];
}

function frameRoots(frame) {
  return frame.activeDynamicBranchIds?.length
    ? [...frame.activeDynamicBranchIds]
    : [frame.contextEntityId].filter(Boolean);
}

function syncFramesToVisibleState(state, visibleEntityIds) {
  const stack = state.contextStack;
  const visible = new Set(visibleEntityIds);
  const page = rootFrame(stack);
  page.visibleEntityIds = [...visibleEntityIds];

  for (let index = 1; index < stack.frames.length; index += 1) {
    const frame = stack.frames[index];
    const roots = frameRoots(frame);
    if (!roots.some((id) => visible.has(id))) {
      stack.frames.splice(index);
      break;
    }
    frame.visibleEntityIds = containedIds(state.entityGraph, roots, visibleEntityIds);
  }
}

function dynamicFrameKind(graph, rootIds) {
  const byId = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const modal = rootIds.some((id) => {
    const entity = byId.get(id);
    const role = String(entity?.structural?.role || '').toLowerCase();
    return entity?.type === 'modal' || role === 'dialog' || role === 'alertdialog';
  });
  return modal ? 'modal' : 'dynamic';
}

function pushRevealedFrame(state, revealedRootIds, visibleEntityIds) {
  const roots = [...new Set(revealedRootIds.filter(Boolean))];
  if (!roots.length) return null;

  const alreadyFramed = new Set(
    state.contextStack.frames.slice(1).flatMap((frame) => frameRoots(frame))
  );
  const newRoots = roots.filter((id) => !alreadyFramed.has(id));
  if (!newRoots.length) return null;

  const scopedVisibleIds = containedIds(state.entityGraph, newRoots, visibleEntityIds);
  return pushContext(state.contextStack, {
    kind: dynamicFrameKind(state.entityGraph, newRoots),
    contextEntityId: newRoots[0],
    visibleEntityIds: scopedVisibleIds,
    activeDynamicBranchIds: newRoots
  });
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

  const pageFrame = rootFrame(state.contextStack);
  const learned = materializeSnapshot(snapshot, registry ? { registry } : {});
  if (learned.page.id !== pageFrame.pageEntityId) {
    throw new Error(`Page changed during refresh: ${pageFrame.pageEntityId} -> ${learned.page.id}`);
  }

  const reconciled = reconcileVisibleState({
    graph: state.entityGraph,
    currentEntities: learned.entities,
    previousVisibleEntityIds: pageFrame.visibleEntityIds,
    trigger
  });

  syncFramesToVisibleState(state, reconciled.visibleEntityIds);
  const pushedFrame = pushRevealedFrame(
    state,
    reconciled.revealedRootIds,
    reconciled.visibleEntityIds
  );
  const frame = activeContext(state.contextStack);

  return {
    ...reconciled,
    pageEntityId: learned.page.id,
    frameId: frame.id,
    ...(pushedFrame ? { pushedFrameId: pushedFrame.id } : {})
  };
}

export function completeActiveFrame(state) {
  if (!state?.contextStack) throw new Error('A current page context is required.');
  if (state.contextStack.frames.length === 1) return null;
  return popContext(state.contextStack);
}
