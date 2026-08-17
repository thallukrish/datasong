import { ProgressiveRepositoryExplorer } from './progressiveRepositoryExplorer.js';

export class ProgressiveRepositoryExplorerV2 extends ProgressiveRepositoryExplorer {
  // ModelDirectedExplorer's semantic-response validator calls this method
  // dynamically. Override it so the progressive browsing operations remain
  // valid after we have entered function-level semantic traversal.
  validateRequest(request, candidates, neighborhood = false) {
    return this.validateBrowseRequest(request, null, candidates, neighborhood);
  }
}
