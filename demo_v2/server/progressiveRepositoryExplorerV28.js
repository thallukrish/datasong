import { ProgressiveRepositoryExplorerV27 } from './progressiveRepositoryExplorerV27.js';
import { ScoutLayerV2 } from './scoutLayerV2.js';

function arr(value) { return Array.isArray(value) ? value : []; }

export class ProgressiveRepositoryExplorerV28 extends ProgressiveRepositoryExplorerV27 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'call-path-preprocessor-scout-discovery-pass1-pass2-v8';
    return state;
  }

  scout() {
    if (!this._scoutLayer || !(this._scoutLayer instanceof ScoutLayerV2)) this._scoutLayer = new ScoutLayerV2(this);
    this._scoutLayer.ensureState();
    return this._scoutLayer;
  }

  callPathCandidates(limit = 10) {
    if (typeof this.topology?.callPathScoutCandidates !== 'function') return [];
    const visited = new Set(arr(this.state?.visited));
    return this.topology.callPathScoutCandidates(limit)
      .filter((candidate) => candidate?.id && !visited.has(candidate.id));
  }

  candidatesFor(observation) {
    const base = super.candidatesFor(observation);
    if (!this.discoveryActive()) return base;

    const byId = new Map();
    for (const candidate of this.callPathCandidates(10)) byId.set(candidate.id, { ...candidate, _locality: 'global' });
    for (const candidate of base) if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
    return [...byId.values()];
  }

  discoveryCandidates(candidates) {
    return arr(candidates).map((candidate) => {
      if (candidate?.kind !== 'call_path_seed') return this.compactCandidate(candidate);
      return {
        id: candidate.id,
        path: candidate.path,
        kind: candidate.kind,
        relation: candidate.relation,
        label: candidate.label,
        hint: candidate.hint,
        effectiveFunctionCount: candidate.effectiveFunctionCount,
        callPathIds: candidate.callPathIds
      };
    }).filter(Boolean);
  }

  candidatePriority(candidate) {
    if (candidate?.kind === 'call_path_seed' || candidate?.relation === 'call_path') {
      return 120 + Number(candidate?.effectiveFunctionCount || 0);
    }
    return super.candidatePriority(candidate);
  }

  scoutPrompt(candidates) {
    const base = super.scoutPrompt(candidates);
    const paths = typeof this.topology?.topCallPaths === 'function'
      ? this.topology.topCallPaths(10).map((path) => ({
        id: path.id,
        entryArtifactId: path.entrySymbolId,
        functionCount: path.functionCount,
        renderedSignatures: path.rendered
      }))
      : [];
    if (!paths.length) return base;
    return `${base}\nLONGEST_RECONSTRUCTED_CALL_PATHS ${JSON.stringify(paths)}\nCall-path guidance:\n- Treat these as deterministic structural evidence only; signatures and call order may suggest orchestration but do not by themselves prove business meaning.\n- Longer paths are intentionally surfaced first as the initial simple heuristic for possible business flows.\n- A path may be a business flow, a technical flow, or a subflow of a broader business flow.\n- If a call path exposes a materially new business-use-case direction, choose its entryArtifactId from BROAD_UNEXPLORED_EVIDENCE.`;
  }
}
