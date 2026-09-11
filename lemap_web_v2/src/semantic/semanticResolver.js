import { findEntity, mergeSemanticPatch } from '../graph/entityGraph.js';

function uniqueIds(values = []) {
  if (!Array.isArray(values)) throw new Error('entityIds must be an array.');
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function validateRequestedEntities(graph, entityIds) {
  for (const entityId of entityIds) {
    if (!findEntity(graph, entityId)) {
      throw new Error(`Unknown entity requested for semantic enrichment: ${entityId}`);
    }
  }
}

function validateResponse(response, requestedIds) {
  if (!response || !Array.isArray(response.patches)) {
    throw new Error('Semantic model response must contain patches.');
  }

  const requested = new Set(requestedIds);
  for (const patch of response.patches) {
    if (!patch?.entityId || !requested.has(String(patch.entityId))) {
      throw new Error(`Semantic patch is outside the requested scope: ${patch?.entityId || '(missing)'}`);
    }
    if (!patch.semantic || typeof patch.semantic !== 'object' || Array.isArray(patch.semantic)) {
      throw new Error('Each semantic patch must contain a semantic object.');
    }
  }
}

export async function enrichEntitySemantics({
  graph,
  gateway,
  entityIds = []
} = {}) {
  if (!graph || !Array.isArray(graph.entities)) {
    throw new Error('A graph with entities is required.');
  }
  if (!gateway || typeof gateway.run !== 'function') {
    throw new Error('A semantic model gateway with run() is required.');
  }

  const requestedIds = uniqueIds(entityIds);
  validateRequestedEntities(graph, requestedIds);

  const response = await gateway.run({
    entityGraph: graph,
    operation: 'enrich_entities',
    entityIds: requestedIds
  });

  validateResponse(response, requestedIds);

  const updatedEntityIds = [];
  for (const patch of response.patches) {
    mergeSemanticPatch(graph, String(patch.entityId), patch.semantic);
    updatedEntityIds.push(String(patch.entityId));
  }

  return {
    graph,
    updatedEntityIds: [...new Set(updatedEntityIds)]
  };
}
