import { ProgressiveRepositoryExplorerV48 } from './progressiveRepositoryExplorerV48.js';
import { withEntityReconciliation } from './explorer/entityReconciliation.js';

export class RepositoryExplorer extends withEntityReconciliation(ProgressiveRepositoryExplorerV48) {}

export default RepositoryExplorer;
