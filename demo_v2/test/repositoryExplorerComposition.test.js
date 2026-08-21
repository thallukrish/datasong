import test from 'node:test';
import assert from 'node:assert/strict';
import { RepositoryExplorer } from '../server/repositoryExplorer.js';

const requiredMethods = [
  // V47 persisted map lifecycle
  'run',
  'persistedMaps',
  'installPersistedMap',
  'loadMostRecentPersistedMap',
  'loadLatestPersistedMapForRepo',

  // V47 structured workflow behavior
  'compactFlowPackage',
  'wholeFlowPrompt',
  'normalizeWholeFlowPass2',
  'applyDelta',
  'evidenceDepth',
  'closeCompletedArcs',

  // V48 semantic model/evidence behavior
  'canonicalEntityName',
  'canonicalizeEntityList',
  'mergeEntityRepresentations',
  'representationDetailsFor',
  'enrichArcEntitySchemas',
  'semanticStore',
  'syncArcSemanticObjects',
  'syncAllSemanticObjects',
  'persistSemanticMap',

  // V48 business-priority Scout behavior
  'prioritySummary',
  'legacyUnrankedWorkflows',
  'scoutPriorityBatch',
  'candidatePrioritySummary',
  'scoutPriorityPrompt',
  'normalizePriorityResult',
  'applyLegacyRankings',
  'promotePriorityPaths',
  'markScoutBatchReviewed',
  'unfinishedWholeFlowArcs',
  'runScout',

  // Current batch reconciliation behavior
  'reconciliationState',
  'businessArcs',
  'entityNamesForArc',
  'contextsFor',
  'candidateSchemasFor',
  'unresolvedTargets',
  'fieldDescriptionTargets',
  'reconcileEntityBatch',
  'finalReconciliation',
  'resolveNextAction'
];

test('canonical RepositoryExplorer retains extracted behavior contracts', () => {
  for (const method of requiredMethods) {
    assert.equal(typeof RepositoryExplorer.prototype[method], 'function', `${method} must remain available`);
  }
});

test('canonical RepositoryExplorer is composed from focused explorer layers', () => {
  const source = RepositoryExplorer.toString();
  assert.match(source, /extends ExplorerWithReconciliation/);
});
