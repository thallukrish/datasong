import { ScoutLayer } from './scoutLayer.js';

function arr(value) { return Array.isArray(value) ? value : []; }

export class ScoutLayerV2 extends ScoutLayer {
  broadCandidates() {
    const base = super.broadCandidates();
    const pathSeeds = typeof this.explorer.topology?.callPathScoutCandidates === 'function'
      ? this.explorer.topology.callPathScoutCandidates(10)
      : [];
    const visited = new Set(arr(this.state().visited));
    const byId = new Map();

    // Prefer call-path evidence for the same concrete symbol because it carries
    // a reconstructed execution signature rather than only a file/frontier hint.
    for (const candidate of base) {
      if (candidate?.id && !visited.has(candidate.id)) byId.set(candidate.id, candidate);
    }
    for (const candidate of pathSeeds) {
      if (candidate?.id && !visited.has(candidate.id)) byId.set(candidate.id, candidate);
    }

    return [...byId.values()]
      .sort((a, b) => this.explorer.candidatePriority(b) - this.explorer.candidatePriority(a));
  }
}
