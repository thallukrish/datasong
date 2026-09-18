import fs from 'node:fs/promises';
import path from 'node:path';
import { ProgressiveRepositoryTopologyV9 } from '../server/progressiveRepositoryTopologyV9.js';
import { withInitialCallPathClassifier } from '../server/explorer/initialCallPathClassifier.js';

const arr = (value) => Array.isArray(value) ? value : [];
const requestedRepo = process.argv[2] || process.env.ACME_ODOO_REPO || path.resolve(process.cwd(), '..', '..', 'acme-ems-odoo');
const repoDir = path.resolve(requestedRepo);
const gitDir = path.join(repoDir, '.git');

try {
  const stat = await fs.stat(gitDir);
  if (!stat.isDirectory()) throw new Error('not a directory');
} catch {
  console.error(`[acme-pass1] ACME repo not found at: ${repoDir}`);
  process.exit(2);
}

const topology = new ProgressiveRepositoryTopologyV9({ cacheRoot: path.resolve(process.cwd(), 'data', 'repo-cache') });
console.log(`[acme-pass1] preparing topology for ${repoDir}`);
const prepareStartedAt = Date.now();
await topology.prepare(repoDir);
console.log(`[acme-pass1] topology ready in ${((Date.now() - prepareStartedAt) / 1000).toFixed(1)}s`);

const Classifier = withInitialCallPathClassifier(class {});
const classifier = new Classifier();
classifier.topology = topology;

const allPaths = topology.callPathIndexer.top(Number.MAX_SAFE_INTEGER);
const topPaths = allPaths.slice(0, 10);

function isCrossRepo(callPath) {
  const sourcePaths = arr(callPath.sourcePaths).map(String);
  const entry = topology.symbolById?.get(callPath.entrySymbolId);
  const startsInProject = String(entry?.name || '').startsWith('odoo-project:')
    || sourcePaths.some((sourcePath) => !sourcePath.startsWith('@odoo'));
  const reachesFramework = sourcePaths.some((sourcePath) => /^@odoo\d+\//.test(sourcePath));
  return startsInProject && reachesFramework;
}

const allCrossRepo = allPaths.filter(isCrossRepo);
const multiFirstClass = allPaths.filter((path) => (path.structuralPriorityEvidence?.firstClassNodeCount || 0) > 1);

console.log(`=== PASS 1 STRUCTURAL HANDOFF ===`);
console.log(`all grouped paths: ${allPaths.length}`);
console.log(`top paths considered by Pass 1: ${topPaths.length}`);
console.log(`cross-repo paths across ALL paths: ${allCrossRepo.length}`);
console.log(`paths with >1 first-class node: ${multiFirstClass.length}`);
if (topology.odooRuntimeEvidence) {
  console.log(`runtime evidence: events=${topology.odooRuntimeEvidence.eventCount} matchedEvents=${topology.odooRuntimeEvidence.matchedEvents} matchedEdges=${topology.odooRuntimeEvidence.matchedEdges} bridgedEdges=${topology.odooRuntimeEvidence.bridgedEdges || 0}`);
  const early = topology.odooExecution?.runtimeTraversal || {};
  console.log(`runtime-guided static DFS: uiSeeds=${early.uiEntrypointsBefore || 0}->${early.uiEntrypointsAfter || 0} branchPoints=${early.frameworkBranchPoints || 0} prunedBranchPoints=${early.prunedFrameworkBranchPoints || 0} prunedEdges=${early.prunedFrameworkEdges || 0}`);
  const traversal = topology.odooRuntimeTraversal || {};
  console.log(`runtime-guided path DFS: branchPoints=${traversal.branchPoints || 0} prunedBranchPoints=${traversal.prunedBranchPoints || 0} prunedEdges=${traversal.prunedEdges || 0} edgeEvidence=${traversal.observedEdgeBranchPoints || 0} targetEvidence=${traversal.observedTargetBranchPoints || 0}`);
}

console.log('\n=== ALL PATH SCORES ===');
for (const [index, callPath] of allPaths.entries()) {
  const compact = classifier.compactCallPath(callPath);
  const evidence = compact.structuralEvidence || {};
  const priority = callPath.structuralPriority ?? '(default)';
  const priorityEvidence = callPath.structuralPriorityEvidence || {};
  const crossRepo = isCrossRepo(callPath);

  console.log(`\n[${index + 1}/${allPaths.length}] ${callPath.id} priority=${priority}`);
  console.log(`flow: ${JSON.stringify(compact.flow || compact.flowSequence || [])}`);
  console.log(`sources: ${arr(callPath.sourcePaths).join(' | ') || '(none)'}`);
  console.log(`first-class nodes (${priorityEvidence.firstClassNodeCount ?? 0}): ${arr(priorityEvidence.firstClassNodes).join(', ') || '(none)'}`);
  console.log(`crossRepo=${crossRepo} excluded=${priorityEvidence.excludedFromPriority === true} boundaries=${priorityEvidence.crossEntityBoundaryCount ?? 0} writes=${priorityEvidence.persistenceWriteCount ?? 0} reads=${priorityEvidence.persistenceReadCount ?? 0} sql=${priorityEvidence.sqlPersistenceCount ?? 0} executable=${priorityEvidence.executableRelationCount ?? 0} functions=${priorityEvidence.functionCount ?? callPath.functionCount ?? 0}`);
  console.log(`handoff entities: ${arr(evidence.entities).join(', ') || '(none)'}`);
}

console.log('\n=== MULTI-FIRST-CLASS PATHS ===');
if (!multiFirstClass.length) console.log('(none)');
for (const [index, callPath] of multiFirstClass.entries()) {
  const priorityEvidence = callPath.structuralPriorityEvidence || {};
  console.log(`[${index + 1}] ${callPath.id} priority=${callPath.structuralPriority ?? '(default)'} nodes=${priorityEvidence.firstClassNodeCount ?? 0} crossRepo=${isCrossRepo(callPath)}`);
  console.log(`  ${arr(callPath.signatures).join(' -> ')}`);
  console.log(`  first-class: ${arr(priorityEvidence.firstClassNodes).join(' -> ') || '(none)'}`);
}

console.log('\n=== CROSS-REPO PATHS ===');
if (!allCrossRepo.length) console.log('(none)');
for (const [index, callPath] of allCrossRepo.entries()) {
  const compact = classifier.compactCallPath(callPath);
  const evidence = compact.structuralEvidence || {};
  const priorityEvidence = callPath.structuralPriorityEvidence || {};
  console.log(`\n[${index + 1}] ${callPath.id} priority=${callPath.structuralPriority ?? '(default)'} firstClass=${priorityEvidence.firstClassNodeCount ?? 0}`);
  console.log(`flow: ${JSON.stringify(compact.flow || compact.flowSequence || [])}`);
  console.log(`entities: ${arr(evidence.entities).join(', ') || '(none)'}`);
  console.log('entity boundaries:');
  if (!arr(evidence.entityBoundaries).length) console.log('  (none)');
  for (const item of arr(evidence.entityBoundaries)) {
    console.log(`  ${item.kind || 'boundary'}: ${item.sourceEntity || '?'} -> ${item.targetEntity || '?'}`);
  }
  console.log('persistence:');
  if (!arr(evidence.persistence).length) console.log('  (none)');
  for (const item of arr(evidence.persistence)) {
    const target = item.logicalEntity || item.persistedEntity || item.target || '?';
    console.log(`  ${item.persistenceKind || 'persistence'}:${item.crud || item.relation || '?'}:${target} @ ${item.at || '?'}`);
  }
}

console.log('\n=== EXECUTABLE EDGE RESOLUTION DIAGNOSTIC ===');
const executableRelations = new Set(['calls', 'routes_to', 'handles', 'triggers', 'on_success', 'on_failure', 'returns_to', 'delayed_trigger']);
const diagnosticPatterns = [
  'sale.order.action_confirm',
  'sale.order._action_confirm',
  'sale.order.line._action_launch_stock_rule',
  'stock.rule.run',
  '_run_manufacture',
  'mrp.production'
];
const diagnosticSymbols = arr(topology.symbols).filter((symbol) => {
  const haystack = `${symbol?.name || ''} ${symbol?.signature || ''}`.toLowerCase();
  return diagnosticPatterns.some((pattern) => haystack.includes(pattern));
});

console.log(`matching symbols: ${diagnosticSymbols.length}`);
for (const symbol of diagnosticSymbols) {
  const refs = arr(symbol.references).filter((ref) => executableRelations.has(String(ref?.relation || '')));
  const outbound = typeof topology.outboundReferenceCandidates === 'function'
    ? arr(topology.outboundReferenceCandidates(symbol))
    : [];
  console.log(`\nSYMBOL ${symbol.id}`);
  console.log(`name: ${symbol.name}`);
  console.log(`source: ${symbol.sourcePath}`);
  console.log(`odooExecution: ${JSON.stringify(symbol.odooExecution || {})}`);
  console.log(`executable refs: ${refs.length}`);
  if (!refs.length) console.log('  (none)');
  for (const ref of refs) {
    const resolved = typeof topology.resolveOutboundReference === 'function'
      ? arr(topology.resolveOutboundReference(symbol, ref))
      : [];
    console.log(`  ref ${ref.relation}:${ref.name} data=${JSON.stringify(ref.data || {})}`);
    console.log(`    resolved(${resolved.length}): ${resolved.map((target) => `${target.id} | ${target.name} | ${target.sourcePath}`).join(' || ') || '(none)'}`);
  }
  console.log(`outbound candidates: ${outbound.length}`);
  for (const edge of outbound) {
    console.log(`  ${edge.relation} -> ${edge.target?.id || '?'} | ${edge.target?.name || '?'} | ${edge.target?.sourcePath || '?'}`);
  }
}

console.log('\n=== PROMPT CONTRACT ===');
console.log('mode: call-path-business-seed-classification-v5');
console.log('structuralEvidence included: entity boundaries + ORM/SQL persistence checkpoints');
