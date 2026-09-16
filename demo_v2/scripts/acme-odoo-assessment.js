import fs from 'node:fs/promises';
import path from 'node:path';
import { ProgressiveRepositoryTopologyV9 } from '../server/progressiveRepositoryTopologyV9.js';

function arr(value) { return Array.isArray(value) ? value : []; }

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
console.log(`unresolved: ${arr(execution.unresolvedCalls).join(', ') || '(none)'}`);

const projectSymbols = arr(topology.symbols)
  .filter((s) => String(s?.name || '').startsWith('odoo-project:'))
  .sort((a, b) => String(a.name).localeCompare(String(b.name)));

console.log('\n=== ACME EXECUTABLE ODOO METHODS / HOOKS ===');
if (!projectSymbols.length) console.log('(none discovered)');
for (const symbol of projectSymbols) {
  const calls = arr(symbol.references)
    .filter((ref) => ref?.relation === 'calls')
    .map((ref) => ref?.name)
    .filter(Boolean);
  console.log(`- ${symbol.name}`);
  for (const call of calls) console.log(`    -> ${call}`);
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
  console.log(`    path: ${callPath.rendered || arr(callPath.signatures).join(' -> ')}`);
}

console.log('\n=== ASSESSMENT ===');
if (projectSymbols.length && Number(execution.frameworkMethods || 0) > 0 && crossRepoPaths.length) {
  console.log('PASS: ACME executable Odoo code crosses into Odoo framework source and reaches CallPathIndexer.');
} else {
  console.log('INCOMPLETE: the static path did not yet prove ACME -> Odoo framework -> CallPathIndexer end to end.');
  if (!projectSymbols.length) console.log('- No ACME Odoo executable methods or manifest hooks were discovered.');
  if (!Number(execution.projectHooks || 0)) console.log('- No manifest lifecycle hook was discovered.');
  if (!Number(execution.frameworkMethods || 0)) console.log('- No Odoo framework methods were reached.');
  if (!crossRepoPaths.length) console.log('- No ACME-to-Odoo call path was identified from CallPathIndexer provenance.');
}
