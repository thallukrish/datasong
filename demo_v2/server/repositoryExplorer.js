import { ProgressiveRepositoryExplorerV39 } from './progressiveRepositoryExplorerV39.js';
import { withCallPathAccess } from './explorer/callPathAccess.js';
import { withWholeFlowPass2 } from './explorer/wholeFlowPass2.js';
import { withWholeFlowScheduler } from './explorer/wholeFlowScheduler.js';
import { withScoutLifecycle } from './explorer/scoutLifecycle.js';
import { withMapPersistence } from './explorer/mapPersistence.js';
import { withPersistedMap } from './explorer/persistedMap.js';
import { withStructuredWorkflow } from './explorer/structuredWorkflow.js';
import { withSemanticModel } from './explorer/semanticModel.js';
import { withBusinessPriorityScout } from './explorer/businessPriorityScout.js';
import { withEntityReconciliation } from './explorer/entityReconciliation.js';

const ExplorerWithCallPathAccess = withCallPathAccess(ProgressiveRepositoryExplorerV39);
const ExplorerWithWholeFlowPass2 = withWholeFlowPass2(ExplorerWithCallPathAccess);
const ExplorerWithWholeFlowScheduler = withWholeFlowScheduler(ExplorerWithWholeFlowPass2);
const ExplorerWithScoutLifecycle = withScoutLifecycle(ExplorerWithWholeFlowScheduler);
const ExplorerWithMapPersistence = withMapPersistence(ExplorerWithScoutLifecycle);
const ExplorerWithPersistedMap = withPersistedMap(ExplorerWithMapPersistence);
const ExplorerWithStructuredWorkflow = withStructuredWorkflow(ExplorerWithPersistedMap);
const ExplorerWithSemanticModel = withSemanticModel(ExplorerWithStructuredWorkflow);
const ExplorerWithBusinessPriority = withBusinessPriorityScout(ExplorerWithSemanticModel);
const ExplorerWithReconciliation = withEntityReconciliation(ExplorerWithBusinessPriority);

export class RepositoryExplorer extends ExplorerWithReconciliation {}

export default RepositoryExplorer;
