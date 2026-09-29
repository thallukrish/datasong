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
import { withSchemaEntityRelationships } from './explorer/schemaEntityRelationships.js';
import { withSchemaCatalogMaterialization } from './explorer/schemaCatalogMaterialization.js';
import { withCompactRunLogging } from './explorer/compactRunLogging.js';
import { withResumeLearning } from './explorer/resumeLearning.js';
import { withPersistedWorkflowResumeGuard } from './explorer/persistedWorkflowResumeGuard.js';
import { withSemanticCompletionGuard } from './explorer/semanticCompletionGuard.js';
import { withCompactMapPersistence } from './explorer/compactMapPersistence.js';

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
const ExplorerWithSchemaEntityRelationships = withSchemaEntityRelationships(ExplorerWithReconciliation);
const ExplorerWithSchemaCatalogMaterialization = withSchemaCatalogMaterialization(ExplorerWithSchemaEntityRelationships);
const ExplorerWithCompactRunLogging = withCompactRunLogging(ExplorerWithSchemaCatalogMaterialization);
const ExplorerWithResumeLearning = withResumeLearning(ExplorerWithCompactRunLogging);
const ExplorerWithPersistedWorkflowResumeGuard = withPersistedWorkflowResumeGuard(ExplorerWithResumeLearning);
const ExplorerWithSemanticCompletionGuard = withSemanticCompletionGuard(ExplorerWithPersistedWorkflowResumeGuard);
const ExplorerWithCompactMapPersistence = withCompactMapPersistence(ExplorerWithSemanticCompletionGuard);

export class RepositoryExplorer extends ExplorerWithCompactMapPersistence {
  setSemanticProfile(profile = 'enterprise') {
    this.semanticProfile = profile === 'code' ? 'code' : 'enterprise';
    if (this.state) this.state.semanticProfile = this.semanticProfile;
  }

  emptyState() {
    const state = super.emptyState();
    state.semanticProfile = this.semanticProfile || 'enterprise';
    state.codeSymbolSemantics = state.codeSymbolSemantics || {};
    state.codeRegionSemantics = state.codeRegionSemantics || {};
    state.codeBranchSemantics = state.codeBranchSemantics || {};
    return state;
  }

  async runScout(candidates) {
    if (this.state?.semanticProfile !== 'code') return super.runScout(candidates);

    const batch = this.scoutPriorityBatch(candidates);
    const existingPathIds = new Set(this.pass1().arcs().flatMap((arc) => [
      arc.callPathId, ...(Array.isArray(arc.callPathVariantIds) ? arc.callPathVariantIds : [])
    ].filter(Boolean)));
    const created = [];

    for (const candidate of batch) {
      const callPathId = (Array.isArray(candidate?.callPathIds) ? candidate.callPathIds : [])[0] || '';
      if (!callPathId || existingPathIds.has(callPathId)) continue;
      const grouped = this.rankedPathById?.(callPathId)
        || this.topology.topCallPaths?.(2500)?.find((path) => path.id === callPathId);
      if (!grouped) continue;
      const firstToken = (Array.isArray(grouped.normalizedFlowTokens) ? grouped.normalizedFlowTokens : [])[0];
      const title = String(candidate.label || firstToken || grouped.entrySymbolId || callPathId).slice(0, 180);
      const arc = this.pass1().createArc({
        title,
        concept: 'Executable code flow awaiting semantic interpretation.',
        confidence: 0.6,
        qualification: 'code_flow',
        semanticKind: 'code_flow'
      }, { id: candidate.id, path: candidate.path || '' });
      if (!arc) continue;
      Object.assign(arc, {
        seedSource: 'code_flow_scout',
        callPathId,
        callPathVariantIds: (Array.isArray(grouped.alternatives) ? grouped.alternatives : []).map((alt) => alt.pathId),
        seedArtifactId: grouped.entrySymbolId || candidate.id,
        seedSourcePath: (Array.isArray(grouped.sourcePaths) ? grouped.sourcePaths : [])[0] || candidate.path || '',
        status: 'forming',
        progress: 0,
        opportunityScore: 0.6,
        semanticKind: 'code_flow'
      });
      this.pass2().seed(arc.id);
      this.flowState(arc);
      existingPathIds.add(callPathId);
      created.push(arc);
    }

    this.markScoutBatchReviewed(batch);
    const next = this.unfinishedWholeFlowArcs('')[0] || null;
    if (next) this.pass1().ensureState().activeArcId = next.id;
    this.pass1().syncStories();
    this.persistSemanticMap?.();
    this.state.lastMessage = next
      ? `Code semantics admitted ${created.length} executable flow(s); interpreting ${next.title}.`
      : 'All discovered code flows have been admitted for semantic interpretation.';
    return next ? { arc: next, rankings: [], created: created.map((arc) => ({ arc })) } : null;
  }
}

export default RepositoryExplorer;
