import fs from 'node:fs/promises';
import path from 'node:path';
import { ProgressiveRepositoryTopologyV9 } from '../server/progressiveRepositoryTopologyV9.js';

function arr(value) { return Array.isArray(value) ? value : []; }

function compactPath(callPath) {
  const signatures = arr(callPath?.signatures);
  const relations = arr(callPath?.relations);
  if (!signatures.length) return '';
  const out = [signatures[0]];
  for (let i = 1; i < signatures.length; i += 1) {
    const relation = relations[i - 1] || 'calls';
    out.push(relation === 'calls' ? '->' : `-[${relation.toUpperCase()}]->`);
    out.push(signatures[i]);
  }
  return out.join(' ');
}

const requestedRepo = process.argv[2] || process.env.ACME_ODOO_REPO || path.resolve(process.cwd(), '..', '..', 'acme-ems-odoo');
const repoDir = path.resolve(requestedRepo);
const gitDir = path.join(repoDir, '.git');

try {
  const stat = await fs.stat(gitDir);
  if (!stat.isDirectory()) throw new Error('not a directory');
} catch {
  console.error(`[acme-assessment] ACME repo not found at: ${repoDir}`);
  console.error('[acme-assessment] Pass the repo path explicitly, e.g.:');
  console.error('  npm run assess:acme -- C:\\path\\to\\acme-ems-odoo');
  process.exit(2);
}

const cacheRoot = path.resolve(process.cwd(), 'data', 'repo-cache');
const topology = new ProgressiveRepositoryTopologyV9({ cacheRoot });

console.log(`[acme-assessment] repo: ${repoDir}`);
if (process.env.ODOO_SOURCE_DIR) console.log(`[acme-assessment] Odoo source: ${process.env.ODOO_SOURCE_DIR}`);
else console.log('[acme-assessment] ODOO_SOURCE_DIR is not set; the adapter may populate its Odoo source cache.');

const result = await topology.prepare(repoDir);

console.log('\n=== ODOO DETECTION ===');
console.log(`framework: ${result.frameworkKind || '(none)'}`);
console.log(`version: ${topology.odooDetection?.version || '(unknown)'}`);
console.log(`addons: ${arr(topology.odooDetection?.addons).map((x) => x?.name).filter(Boolean).join(', ') || '(none)'}`);

console.log('\n=== ODOO PATTERN REGISTRY ===');
const patternEvidence = arr(result.odooPatterns);
const patternRules = [...new Set(patternEvidence.map((fact) => fact?.provenance?.ruleId).filter(Boolean))].sort();
console.log(`matches: ${patternEvidence.length}`);
console.log(`rules matched: ${patternRules.join(', ') || '(none)'}`);

console.log('\n=== ACME / ODOO EXECUTION ===');
const execution = topology.odooExecution || {};
console.log(`project methods: ${Number(execution.projectMethods || 0)}`);
console.log(`manifest hooks: ${Number(execution.projectHooks || 0)}`);
console.log(`framework methods reached: ${Number(execution.frameworkMethods || 0)}`);
console.log(`super() bridges: ${Number(execution.bridgedSuperCalls || 0)}`);
console.log(`UI entrypoint seeds: ${Number(execution.uiEntrypointSeeds || 0)}`);
console.log(`unresolved calls: ${arr(execution.unresolvedCalls).join(', ') || '(none)'}`);
console.log(`unresolved persistence: ${arr(execution.unresolvedPersistence).join(', ') || '(none)'}`);

const stats = execution.structuralStats || {};
console.log('\n=== STRUCTURAL COVERAGE ===');
console.log(`first-class Odoo methods: ${Number(stats.firstClassMethods || 0)}`);
console.log(`cross-model calls: ${Number(stats.crossModelCalls || 0)}`);
console.log(`same-model calls: ${Number(stats.sameModelCalls || 0)}`);
console.log(`helper/library calls classified: ${Number(stats.helperCalls || 0)}`);
console.log(`ORM CRUD: read=${Number(stats.ormReads || 0)} create=${Number(stats.ormCreates || 0)} update=${Number(stats.ormUpdates || 0)} delete=${Number(stats.ormDeletes || 0)}`);
console.log(`SQL CRUD: read=${Number(stats.sqlReads || 0)} create=${Number(stats.sqlCreates || 0)} update=${Number(stats.sqlUpdates || 0)} delete=${Number(stats.sqlDeletes || 0)}`);
console.log(`truncated: ${Boolean(execution.truncated)}`);
console.log(`framework safety cap: ${Number(execution.maxFrameworkMethods || 0)}`);
console.log(`remaining framework queue: ${Number(execution.remainingFrameworkQueue || 0)}`);
if (execution.truncated) {
  console.log('WARNING: static Odoo traversal hit the framework-method safety cap; this is boundary proof, not complete static coverage.');
}

const projectSymbols = arr(topology.symbols)
  .filter((s) => String(s?.name || '').startsWith('odoo-project:'))
  .sort((a, b) => String(a.name).localeCompare(String(b.name)));

console.log('\n=== ACME EXECUTABLE ODOO METHODS / HOOKS ===');
if (!projectSymbols.length) console.log('(none discovered)');
for (const symbol of projectSymbols) {
  const calls = arr(symbol.references)
    .filter((ref) => ref?.relation === 'calls')
    .map((ref) => ({ name: ref?.name, boundary: ref?.data?.boundaryKind || '' }))
    .filter((ref) => ref.name);
  const persistence = arr(symbol.references)
    .filter((ref) => ['reads', 'writes'].includes(ref?.relation) && ref?.data?.operationKind === 'persistence')
    .map((ref) => `${ref.data.persistenceKind}:${ref.data.crud}:${ref.name}`);
  console.log(`- ${symbol.name}`);
  for (const call of calls) console.log(`    -> ${call.name}${call.boundary ? ` [${call.boundary}]` : ''}`);
  for (const operation of persistence) console.log(`    * ${operation}`);
}

const paths = topology.topCallPaths(30);
const crossRepoPaths = paths.filter((p) => {
  const sourcePaths = arr(p.sourcePaths).map((value) => String(value || ''));
  const entrySymbol = topology.symbolById?.get(p.entrySymbolId);
  const startsInProject = String(entrySymbol?.name || '').startsWith('odoo-project:')
    || sourcePaths.some((sourcePath) => !sourcePath.startsWith('@odoo'));
  const reachesFramework = sourcePaths.some((sourcePath) => /^@odoo\d+\//.test(sourcePath));
  return startsInProject && reachesFramework;
});

console.log('\n=== CALL PATH INDEX ===');
console.log(`ranked paths: ${paths.length}`);
console.log(`cross-repo paths: ${crossRepoPaths.length}`);

console.log('\n=== CROSS-REPO CALL PATHS ===');
if (!crossRepoPaths.length) console.log('(none yet)');
for (const [index, callPath] of crossRepoPaths.entries()) {
  const entrySymbol = topology.symbolById?.get(callPath.entrySymbolId);
  console.log(`\n[${index + 1}] entry: ${entrySymbol?.name || callPath.entrySymbolId}`);
  console.log(`    sources: ${arr(callPath.sourcePaths).join(' -> ')}`);
  console.log(`    path: ${compactPath(callPath) || callPath.rendered || arr(callPath.signatures).join(' -> ')}`);
}

console.log('\n=== ASSESSMENT ===');
if (projectSymbols.length && Number(execution.frameworkMethods || 0) > 0 && crossRepoPaths.length) {
  console.log('PASS: ACME executable Odoo code crosses into Odoo framework source and reaches CallPathIndexer.');
  if (execution.truncated) console.log('NOTE: traversal is truncated, so PASS does not imply complete static coverage.');
} else {
  console.log('INCOMPLETE: the static path did not yet prove ACME -> Odoo framework -> CallPathIndexer end to end.');
  if (!projectSymbols.length) console.log('- No ACME Odoo executable methods or manifest hooks were discovered.');
  if (!Number(execution.projectHooks || 0)) console.log('- No manifest lifecycle hook was discovered.');
  if (!Number(execution.frameworkMethods || 0)) console.log('- No Odoo framework methods were reached.');
  if (!crossRepoPaths.length) console.log('- No ACME-to-Odoo call path was identified from CallPathIndexer provenance.');
}
