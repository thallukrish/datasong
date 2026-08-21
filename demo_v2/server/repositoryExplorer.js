import { ModelDirectedExplorerV2 } from './modelDirectedExplorerV2.js';
import { withLightweightModelCall } from './explorer/modelCall.js';
import { withPass1State } from './explorer/pass1State.js';
import { withCallPathPreprocessLifecycle } from './explorer/callPathPreprocessLifecycle.js';
import { withCallPathSeedPreprocessor } from './explorer/callPathSeedPreprocessor.js';
import { withInitialCallPathClassifier } from './explorer/initialCallPathClassifier.js';
import { withBusinessMapAccumulation } from './explorer/businessMapAccumulation.js';
import { withInitialCallPathSeeds } from './explorer/initialCallPathSeeds.js';
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

const ExplorerWithModelCall = withLightweightModelCall(ModelDirectedExplorerV2);
const ExplorerWithPass1State = withPass1State(ExplorerWithModelCall);
const ExplorerWithPreprocessLifecycle = withCallPathPreprocessLifecycle(ExplorerWithPass1State);
const ExplorerWithSeedPreprocessor = withCallPathSeedPreprocessor(ExplorerWithPreprocessLifecycle);
const ExplorerWithInitialClassifier = withInitialCallPathClassifier(ExplorerWithSeedPreprocessor);
const ExplorerWithBusinessMap = withBusinessMapAccumulation(ExplorerWithInitialClassifier);
const ExplorerWithInitialSeeds = withInitialCallPathSeeds(ExplorerWithBusinessMap);
const ExplorerWithCallPathAccess = withCallPathAccess(ExplorerWithInitialSeeds);
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
