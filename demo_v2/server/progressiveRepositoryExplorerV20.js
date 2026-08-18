import { ProgressiveRepositoryExplorerV19 } from './progressiveRepositoryExplorerV19.js';

function cleanRepoPath(value = '') {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export class ProgressiveRepositoryExplorerV20 extends ProgressiveRepositoryExplorerV19 {
  normalizeSemanticSourceContainerRequest(request) {
    if (!request || typeof request !== 'object') return request;
    const raw = String(request.artifactId || '').trim();
    if (!raw.startsWith('semantic:')) return request;

    // A real semantic-unit id contains the source path followed by #<unit>.
    // When the model returns semantic:<tracked-file> with no # suffix, it is
    // clearly referring to the containing source/XML artifact. Resolve that
    // deterministic alias instead of paying for a retry.
    const afterPrefix = raw.slice('semantic:'.length);
    if (afterPrefix.includes('#')) return request;
    const sourcePath = cleanRepoPath(afterPrefix);
    if (!sourcePath || !this.topology.trackedFiles?.includes(sourcePath)) return request;

    request.type = 'getArtifact';
    request.artifactId = `file:${sourcePath}`;
    request._normalizedSemanticSourceContainer = raw;
    return request;
  }

  validateBrowseRequest(request, observation, candidates) {
    this.normalizeSemanticSourceContainerRequest(request);
    return super.validateBrowseRequest(request, observation, candidates);
  }

  async resolveNextAction(action, candidates) {
    this.normalizeSemanticSourceContainerRequest(action);
    return super.resolveNextAction(action, candidates);
  }

  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);
    if (observation?.kind !== 'semantic_function') return base;
    const source = cleanRepoPath(observation?.canonical?.provenance?.source || observation?.sourcePath || '');
    if (!source || !this.topology.trackedFiles?.includes(source)) return base;
    return `${base}\nSOURCE-CONTAINER file:${source} (use getArtifact only if the containing artifact itself is needed).`;
  }
}
