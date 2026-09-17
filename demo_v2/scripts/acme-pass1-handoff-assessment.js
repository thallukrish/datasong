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
await topology.prepare(repoDir);

const Classifier = withInitialCallPathClassifier(class {});
const classifier = new Classifier();
classifier.topology = topology;

const paths = topology.topCallPaths(10);
const crossRepo = paths.filter((callPath) => {
  const sourcePaths = arr(callPath.sourcePaths).map(String);
  const entry = topology.symbolById?.get(callPath.entrySymbolId);
  const startsInProject = String(entry?.name || '').startsWith('odoo-project:')
    || sourcePaths.some((sourcePath) => !sourcePath.startsWith('@odoo'));
  const reachesFramework = sourcePaths.some((sourcePath) => /^@odoo\d+\//.test(sourcePath));
  return startsInProject && reachesFramework;
});

console.log(`=== PASS 1 STRUCTURAL HANDOFF ===`);
console.log(`top paths: ${paths.length}`);
console.log(`cross-repo paths in top set: ${crossRepo.length}`);

console.log('\n=== TOP PATH PRIORITIES ===');
for (const [index, callPath] of paths.entries()) {
  const compact = classifier.compactCallPath(callPath);
  const evidence = compact.structuralEvidence || {};
  const priority = callPath.structuralPriority ?? '(default)';
  const priorityEvidence = callPath.structuralPriorityEvidence || {};
  console.log(`\n[${index + 1}] ${callPath.id} priority=${priority}`);
  console.log(`flow: ${JSON.stringify(compact.flow || compact.flowSequence || [])}`);
  console.log(`sources: ${arr(callPath.sourcePaths).join(' | ') || '(none)'}`);
  console.log(`priority entities: ${arr(priorityEvidence.firstClassEntities).join(', ') || '(none)'}`);
  console.log(`priority boundaries=${priorityEvidence.crossEntityBoundaryCount ?? 0} writes=${priorityEvidence.persistenceWriteCount ?? 0} reads=${priorityEvidence.persistenceReadCount ?? 0} sql=${priorityEvidence.sqlPersistenceCount ?? 0} executable=${priorityEvidence.executableRelationCount ?? 0} functions=${priorityEvidence.functionCount ?? callPath.functionCount ?? 0}`);
  console.log(`handoff entities: ${arr(evidence.entities).join(', ') || '(none)'}`);
}

console.log('\n=== CROSS-REPO DETAILS ===');
for (const [index, callPath] of crossRepo.entries()) {
  const compact = classifier.compactCallPath(callPath);
  const evidence = compact.structuralEvidence || {};
  console.log(`\n[${index + 1}] ${compact.pathId}`);
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

console.log('\n=== PROMPT CONTRACT ===');
console.log('mode: call-path-business-seed-classification-v5');
console.log('structuralEvidence included: entity boundaries + ORM/SQL persistence checkpoints');
