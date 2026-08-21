import test from 'node:test';
import assert from 'node:assert/strict';
import { RepositoryExplorer } from '../server/repositoryExplorer.js';

const requiredMethods = [
  // V48 semantic model/evidence behavior
  'wholeFlowPrompt',
  'normalizeWholeFlowPass2',
  'canonicalEntityName',
  'canonicalizeEntityList',
  'mergeEntityRepresentations',
  'representationDetailsFor',
  'enrichArcEntitySchemas',
  'semanticStore',
  'syncArcSemanticObjects',
  'syncAllSemanticObjects',
  'applyDelta',
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

test('canonical RepositoryExplorer is composed without V48 as its direct base', () => {
  const source = RepositoryExplorer.toString();
  assert.match(source, /extends ExplorerWithReconciliation/);
});
