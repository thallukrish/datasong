function arr(value) { return Array.isArray(value) ? value : []; }

export function isEmptyEntityDelta(delta = {}) {
  const arrayKeys = [
    'fieldValuesChanged', 'fieldsEnabled', 'fieldsDisabled', 'fieldsShown', 'fieldsHidden', 'fieldsAdded', 'fieldsRemoved',
    'actionsEnabled', 'actionsDisabled', 'actionsShown', 'actionsHidden', 'regionsShown', 'regionsHidden',
    'validationMessagesAdded', 'validationMessagesRemoved'
  ];
  if (arrayKeys.some((key) => arr(delta?.[key]).length > 0)) return false;
  if (Object.values(delta?.optionsAdded || {}).some((values) => arr(values).length > 0)) return false;
  if (Object.values(delta?.optionsRemoved || {}).some((values) => arr(values).length > 0)) return false;
  if (delta?.routeChanged || delta?.entityChanged) return false;
  return true;
}

export function classifyTransition(delta = {}, context = {}) {
  if (delta.entityChanged || delta.routeChanged) return 'navigation';
  if (context.overlayOpened) return 'overlay_open';
  if (arr(delta.fieldsAdded).length || arr(delta.regionsShown).length) return 'inline_expand';
  return 'state_change';
}

export function createWorkflowGraph(id = 'workflow:structural') {
  return { id, nodes: new Set(), edges: [], entityStates: {} };
}

function ensureStateSet(graph, entityId) {
  if (!entityId) return null;
  if (!graph.entityStates[entityId]) graph.entityStates[entityId] = new Set();
  return graph.entityStates[entityId];
}

export function recordTransition(graph, transition = {}) {
  if (!graph || !graph.nodes || !Array.isArray(graph.edges)) throw new Error('Invalid workflow graph');
  const sourceEntityId = String(transition.sourceEntityId || '');
  const targetEntityId = String(transition.targetEntityId || sourceEntityId);
  if (sourceEntityId) graph.nodes.add(sourceEntityId);
  if (targetEntityId) graph.nodes.add(targetEntityId);
  if (transition.sourceStateId) ensureStateSet(graph, sourceEntityId)?.add(String(transition.sourceStateId));
  if (transition.targetStateId) ensureStateSet(graph, targetEntityId)?.add(String(transition.targetStateId));
  if (isEmptyEntityDelta(transition.delta || {})) return null;

  const edge = {
    id: String(transition.id || `edge:${graph.edges.length + 1}`),
    sourceEntityId,
    targetEntityId,
    sourceStateId: String(transition.sourceStateId || ''),
    targetStateId: String(transition.targetStateId || ''),
    actionId: String(transition.actionId || ''),
    kind: String(transition.kind || classifyTransition(transition.delta || {}, transition.context || {})),
    branchCondition: String(transition.branchCondition || ''),
    evidenceIds: [...new Set(arr(transition.evidenceIds).map(String).filter(Boolean))],
    delta: transition.delta ? structuredClone(transition.delta) : null,
    presentation: transition.presentation ? structuredClone(transition.presentation) : null
  };
  graph.edges.push(edge);
  return edge;
}

export function serializeWorkflowGraph(graph = {}) {
  const entityStates = {};
  for (const [entityId, states] of Object.entries(graph.entityStates || {})) entityStates[entityId] = [...states];
  return { id: graph.id || '', nodes: [...(graph.nodes || [])], edges: arr(graph.edges).map((edge) => structuredClone(edge)), entityStates };
}
