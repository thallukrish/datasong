import { ProgressiveRepositoryExplorerV52 } from './progressiveRepositoryExplorerV52.js';

/**
 * Canonical runtime explorer.
 *
 * This is the only explorer class new server code should import.
 * The numbered ProgressiveRepositoryExplorerV* files are legacy implementation
 * layers from iterative development and must not be referenced by new code.
 *
 * New behavior belongs here or in focused collaborators (Scout, Pass 1, Pass 2,
 * reconciliation, persistence, semantic evidence), not in another V-numbered
 * subclass.
 */
export class RepositoryExplorer extends ProgressiveRepositoryExplorerV52 {}

export default RepositoryExplorer;
