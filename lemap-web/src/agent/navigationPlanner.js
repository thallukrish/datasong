import { resolveNavigationTopology } from './navigationTopology.js';
import { redactModelText } from '../semantic/modelPrivacy.js';

function arr(value) { return Array.isArray(value) ? value : []; }

function applyPatch(entity, patch) {
  if (!entity || !patch?.semantic) return entity;
  return { ...entity, semantic: { ...entity.semantic, ...structuredClone(patch.semantic) } };
}

function safeLabel(entity = {}, privacyEntities = []) {
  const value = redactModelText(entity.name || entity.id || '', privacyEntities)
    .trim()
    .replace(/\s+/g, ' ');
  return value.length > 120 ? `${value.slice(0, 120)}…` : value;
}

function printDiagnostics(topology = {}, currentEntities = [], blocked = new Set()) {
  const byId = new Map(arr(currentEntities).map((entity) => [entity.id, entity]));
  const rows = [];

  for (const patch of arr(topology.deterministicPatches)) {
    const entity = byId.get(patch.id);
    if (!entity) continue;
    const role = patch.semantic?.workflowRole || 'resolved';
    rows.push({
      id: entity.id,
      label: safeLabel(entity, currentEntities),
      disposition: blocked.has(entity.id) ? `blocked-${role}` : role === 'continue' ? 'learned-forward' : role
    });
  }

  for (const entity of arr(topology.modelCandidates)) {
    rows.push({
      id: entity.id,
      label: safeLabel(entity, currentEntities),
      disposition: blocked.has(entity.id) ? 'blocked-model-candidate' : 'model-candidate'
    });
  }

  if (!rows.length) return;
  console.log('[LeMap-Web] navigation diagnostics:');
  for (const row of rows) console.log(`  ${row.disposition.padEnd(24)} ${row.id}  ${row.label}`);
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
  printDiagnostics(topology, currentEntities, blocked);

  const learnedForward = topology.deterministicPatches
    .filter((patch) => patch.semantic?.workflowRole === 'continue')
    .map((patch) => applyPatch(byId.get(patch.id), patch))
    .filter((entity) => entity && !blocked.has(entity.id));

  if (learnedForward.length === 1) {
    console.log(`[LeMap-Web] navigation selected: ${learnedForward[0].id} [learned_transition]`);
    return { entity: learnedForward[0], source: 'learned_transition', topologyCount: topology.deterministicPatches.length };
  }

  const unresolved = topology.modelCandidates.filter((entity) => !blocked.has(entity.id));
  if (unresolved.length === 1) {
    console.log(`[LeMap-Web] navigation selected: ${unresolved[0].id} [sole_candidate]`);
    return { entity: unresolved[0], source: 'sole_candidate', topologyCount: topology.deterministicPatches.length };
  }

  const candidates = learnedForward.length > 1 ? learnedForward : unresolved;
  if (!candidates.length || typeof choose !== 'function') {
    console.log('[LeMap-Web] navigation selected: none [no_candidates]');
    return { entity: null, source: 'none', topologyCount: topology.deterministicPatches.length };
  }

  const selected = await choose({ candidates });
  const selectedId = String(selected?.id || '');
  const entity = candidates.find((candidate) => candidate.id === selectedId) || null;
  console.log(`[LeMap-Web] navigation selected: ${entity ? `${entity.id} ${safeLabel(entity, currentEntities)}` : 'none'} [model_choice]`);
  return { entity, source: entity ? 'model_choice' : 'none', topologyCount: topology.deterministicPatches.length };
}
