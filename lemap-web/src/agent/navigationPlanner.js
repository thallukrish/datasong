import { resolveNavigationTopology } from './navigationTopology.js';

function arr(value) { return Array.isArray(value) ? value : []; }

function applyPatch(entity, patch) {
  if (!entity || !patch?.semantic) return entity;
  return { ...entity, semantic: { ...entity.semantic, ...structuredClone(patch.semantic) } };
}

export async function planNavigation({
  entityGraph = [],
  currentEntities = [],
  currentPageId = '',
  recentPageTrail = [],
  blockedEntityIds = new Set(),
  choose
} = {}) {
  const blocked = blockedEntityIds instanceof Set ? blockedEntityIds : new Set(arr(blockedEntityIds).map(String));
  const topology = resolveNavigationTopology({ entityGraph, currentEntities, currentPageId, recentPageTrail });
  const byId = new Map(arr(currentEntities).map((entity) => [entity.id, entity]));

  const learnedForward = topology.deterministicPatches
    .filter((patch) => patch.semantic?.workflowRole === 'continue')
    .map((patch) => applyPatch(byId.get(patch.id), patch))
    .filter((entity) => entity && !blocked.has(entity.id));

  if (learnedForward.length === 1) {
    return { entity: learnedForward[0], source: 'learned_transition', topologyCount: topology.deterministicPatches.length };
  }

  const unresolved = topology.modelCandidates.filter((entity) => !blocked.has(entity.id));
  if (unresolved.length === 1) {
    return { entity: unresolved[0], source: 'sole_candidate', topologyCount: topology.deterministicPatches.length };
  }

  const candidates = learnedForward.length > 1 ? learnedForward : unresolved;
  if (!candidates.length || typeof choose !== 'function') {
    return { entity: null, source: 'none', topologyCount: topology.deterministicPatches.length };
  }

  const selected = await choose({ candidates });
  const selectedId = String(selected?.id || '');
  const entity = candidates.find((candidate) => candidate.id === selectedId) || null;
  return { entity, source: entity ? 'model_choice' : 'none', topologyCount: topology.deterministicPatches.length };
}
