import { findEntity, mergeSemanticPatch } from '../graph/entityGraph.js';
import {
  selectSemanticCandidates,
  buildSemanticRequest,
  normalizeSemanticResponse,
  buildNavigationRequest,
  normalizeNavigationResponse
} from './semanticProtocol.js';

function uniqueIds(values = []) {
  if (!Array.isArray(values)) throw new Error('entityIds must be an array.');
  return [...new Set(values.filter(Boolean).map(String))];
}

export async function enrichEntitySemantics({
  graph,
  gateway,
  entityIds = [],
  query = '',
  workflowPages = [],
  currentPage = null
} = {}) {
  if (!graph || !Array.isArray(graph.entities)) throw new Error('A graph with entities is required.');
  if (!gateway || typeof gateway.run !== 'function') throw new Error('A semantic model gateway with run() is required.');

  const requestedIds = uniqueIds(entityIds);
  for (const id of requestedIds) if (!findEntity(graph, id)) throw new Error(`Unknown entity requested for semantic enrichment: ${id}`);

  const requested = requestedIds.length
    ? requestedIds.map((id) => findEntity(graph, id)).filter(Boolean)
    : graph.entities;
  const candidates = selectSemanticCandidates(requested);
  if (!candidates.length) return { graph, updatedEntityIds: [], called: false };

  const payload = buildSemanticRequest({ query, workflowPages, currentPage, entities: candidates });
  const response = await gateway.run({ operation: 'enrich_entities', payload });
  const patches = normalizeSemanticResponse(response, candidates.map((entity) => entity.id));

  for (const patch of patches) mergeSemanticPatch(graph, patch.entityId, patch.semantic);
  return { graph, updatedEntityIds: patches.map((patch) => patch.entityId), called: true };
}

export async function chooseNavigationCandidate({
  gateway,
  query = '',
  workflowPages = [],
  currentPage = null,
  candidates = []
} = {}) {
  if (!gateway || typeof gateway.run !== 'function') throw new Error('A semantic model gateway with run() is required.');
  const options = candidates.filter((entity) => entity?.id && entity.type === 'ui_control' && ['button', 'link'].includes(String(entity.structural?.controlType || '')) && entity.structural?.disabled !== true);
  if (!options.length) return null;
  if (options.length === 1) return options[0];

  const payload = buildNavigationRequest({ query, workflowPages, currentPage, candidates: options });
  const response = await gateway.run({ operation: 'choose_navigation', payload });
  const selectedId = normalizeNavigationResponse(response, options.map((entity) => entity.id));
  return options.find((entity) => entity.id === selectedId) || null;
}
