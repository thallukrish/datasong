import { ProgressiveRepositoryExplorerV13 } from './progressiveRepositoryExplorerV13.js';

function cleanPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || '.';
}

export class ProgressiveRepositoryExplorerV14 extends ProgressiveRepositoryExplorerV13 {
  normalizeRepeatedDirectoryRequest(request, observation) {
    if (!request || request.type !== 'listDirectory' || observation?.kind !== 'repo_directory') return request;

    const requested = cleanPath(request.path);
    const current = cleanPath(observation.path || observation.canonical?.path);
    if (requested !== current) return request;

    const currentForTopology = current === '.' ? '' : current;
    const drillTarget = typeof this.topology.singleChainTarget === 'function'
      ? this.topology.singleChainTarget(currentForTopology, 4)
      : null;

    if (drillTarget && cleanPath(drillTarget) !== current) {
      request.path = drillTarget;
      request._normalizedRepeatedDirectory = 'drillTarget';
      return request;
    }

    const childDirectories = (Array.isArray(observation.canonical?.entries) ? observation.canonical.entries : [])
      .filter((entry) => entry?.kind === 'directory' && entry?.path)
      .map((entry) => entry.path);

    if (childDirectories.length === 1) {
      request.path = childDirectories[0];
      request._normalizedRepeatedDirectory = 'singleChildDirectory';
    }

    return request;
  }

  validateBrowseRequest(request, observation, candidates) {
    this.normalizeRepeatedDirectoryRequest(request, observation);

    if (request?.type === 'listDirectory' && observation?.kind === 'repo_directory') {
      const requested = cleanPath(request.path);
      const current = cleanPath(observation.path || observation.canonical?.path);
      if (requested === current) {
        // Multiple structural choices remain. Do not consume a retry and do not
        // choose a semantic path for the model. Mark the request so execution can
        // return a compact child-choice observation.
        request._needsDirectoryChoice = true;
        return;
      }
    }

    return super.validateBrowseRequest(request, observation, candidates);
  }

  directoryChoiceObservation(observation) {
    const current = observation || {};
    const entries = (Array.isArray(current.canonical?.entries) ? current.canonical.entries : [])
      .map((entry) => ({
        id: entry.id,
        path: entry.path,
        kind: entry.kind,
        name: entry.name,
        preview: entry.kind === 'directory' ? entry.preview : undefined
      }));

    const neighbors = Array.isArray(current.neighbors) ? current.neighbors : [];
    return {
      ...current,
      id: `directory-choice:${cleanPath(current.path || current.canonical?.path)}:${this.state.step}`,
      kind: 'repo_directory',
      summary: `Choose a child of ${current.path || current.canonical?.path || '/'}`,
      canonical: {
        kind: 'directory_choice',
        path: current.path || current.canonical?.path || '/',
        entries,
        note: 'The current directory is already listed. Choose one child directory/file or a previewed drillTarget. Do not request this same directory again.'
      },
      neighbors
    };
  }

  async resolveNextAction(action, candidates) {
    const request = action || { type: 'stop' };

    if (request.type === 'listDirectory' && request._needsDirectoryChoice) {
      const currentId = this._currentObservationId || '';
      const current = this.state?.lastObservation || null;

      // The run loop does not persist the full observation in state, so recover
      // the current listing deterministically from the requested path.
      const listing = this.topology.listDirectory(request.path === '.' ? '' : request.path);
      const choice = this.directoryChoiceObservation(listing);
      choice.canonical.recoveryFrom = currentId;
      return choice;
    }

    return super.resolveNextAction(request, candidates);
  }
}
