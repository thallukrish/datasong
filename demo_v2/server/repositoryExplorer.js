import { ProgressiveRepositoryExplorerV45 } from './progressiveRepositoryExplorerV45.js';
import { withMapPersistence } from './explorer/mapPersistence.js';
import { withPersistedMap } from './explorer/persistedMap.js';
import { withStructuredWorkflow } from './explorer/structuredWorkflow.js';
import { withSemanticModel } from './explorer/semanticModel.js';
import { withBusinessPriorityScout } from './explorer/businessPriorityScout.js';
import { withEntityReconciliation } from './explorer/entityReconciliation.js';

const ExplorerWithMapPersistence = withMapPersistence(ProgressiveRepositoryExplorerV45);
const ExplorerWithPersistedMap = withPersistedMap(ExplorerWithMapPersistence);
const ExplorerWithStructuredWorkflow = withStructuredWorkflow(ExplorerWithPersistedMap);
const ExplorerWithSemanticModel = withSemanticModel(ExplorerWithStructuredWorkflow);
const ExplorerWithBusinessPriority = withBusinessPriorityScout(ExplorerWithSemanticModel);
const ExplorerWithReconciliation = withEntityReconciliation(ExplorerWithBusinessPriority);

export class RepositoryExplorer extends ExplorerWithReconciliation {}

export default RepositoryExplorer;
