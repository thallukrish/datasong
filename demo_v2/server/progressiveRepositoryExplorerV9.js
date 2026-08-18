import { ProgressiveRepositoryExplorerV8 } from './progressiveRepositoryExplorerV8.js';

function cleanRepoPath(value = '') {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export class ProgressiveRepositoryExplorerV9 extends ProgressiveRepositoryExplorerV8 {
  normalizeRepositoryRequest(request, candidates = []) {
    if (!request || typeof request !== 'object') return request;
    if (request.type !== 'getArtifact') return request;

    const raw = String(request.artifactId || '').trim();
    if (!raw) return request;

    // Already canonical or a known semantic unit: leave it alone.
    if (raw.startsWith('file:') || raw.startsWith('dir:') || this.topology.symbolById?.has(raw)) return request;

    const cleaned = cleanRepoPath(raw);

    // If the model copied a repository path instead of the canonical file id,
    // canonicalize it deterministically. This is repository mechanics, not a
    // semantic decision, and should never consume an LLM retry.
    if (this.topology.trackedFiles?.includes(cleaned)) {
      request.artifactId = `file:${cleaned}`;
      return request;
    }

    // Also accept an exact path exposed in the current candidate set. This
    // covers directory/file descriptors whose canonical ids are already known
    // locally but whose human-readable path was returned by the model.
    const match = (Array.isArray(candidates) ? candidates : []).find((candidate) => {
      const candidatePath = cleanRepoPath(candidate?.path || '');
      return candidatePath && candidatePath === cleaned;
    });
    if (match?.id) request.artifactId = match.id;

    return request;
  }

  validateBrowseRequest(request, observation, candidates) {
    this.normalizeRepositoryRequest(request, candidates);
    return super.validateBrowseRequest(request, observation, candidates);
  }

  async resolveNextAction(action, candidates) {
    this.normalizeRepositoryRequest(action, candidates);
    return super.resolveNextAction(action, candidates);
  }
}
