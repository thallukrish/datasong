import fs from 'node:fs/promises';
import path from 'node:path';
import { ProgressiveRepositoryTopologyV9 } from '../server/progressiveRepositoryTopologyV9.js';
import { withInitialCallPathClassifier } from '../server/explorer/initialCallPathClassifier.js';
import { withWholeFlowPass2 } from '../server/explorer/wholeFlowPass2.js';

const arr = (value) => Array.isArray(value) ? value : [];
const requestedRepo = process.argv[2] || process.env.ACME_ODOO_REPO || path.resolve(process.cwd(), '..', '..', 'acme-ems-odoo');
const repoDir = path.resolve(requestedRepo);
const gitDir = path.join(repoDir, '.git');

try {
  const stat = await fs.stat(gitDir);
  if (!stat.isDirectory()) throw new Error('not a directory');
} catch {
  console.error(`[acme-pass2] ACME repo not found at: ${repoDir}`);
  process.exit(2);
}

const topology = new ProgressiveRepositoryTopologyV9({ cacheRoot: path.resolve(process.cwd(), 'data', 'repo-cache') });
await topology.prepare(repoDir);

class Base {
  groupedPathForArc() { return this._grouped || null; }
}
const Explorer = withWholeFlowPass2(withInitialCallPathClassifier(Base));
const explorer = new Explorer();
explorer.topology = topology;

const paths = topology.topCallPaths(10);
const crossRepo = paths.filter((callPath) => {
  const sourcePaths = arr(callPath.sourcePaths).map(String);
  const entry = topology.symbolById?.get(callPath.entrySymbolId);
  const startsInProject = String(entry?.name || '').startsWith('odoo-project:')
    || sourcePaths.some((sourcePath) => !sourcePath.startsWith('@odoo'));
  const reachesFramework = sourcePaths.some((sourcePath) => /^@odoo\d+\//.test(sourcePath));
  return startsInProject && reachesFramework;
});

console.log('=== PASS 2 SOURCE-EVIDENCE HANDOFF ===');
console.log(`top paths: ${paths.length}`);
console.log(`cross-repo paths in top set: ${crossRepo.length}`);

for (const [index, callPath] of crossRepo.entries()) {
  explorer._grouped = callPath;
  const pkg = explorer.compactFlowPackage({ id: `assessment:${index + 1}` });
  const functions = arr(pkg?.functionEvidence);
  const totalBodyChars = functions.reduce((sum, item) => sum + String(item?.body || '').length, 0);

  console.log(`\n[${index + 1}] ${callPath.id}`);
  console.log(`selected concrete path: ${pkg?.selectedConcretePathId || '(none)'}`);
  console.log(`grouped alternatives: ${arr(callPath.alternatives).length}`);
  console.log(`functions with bodies: ${functions.length}`);
  console.log(`total body chars: ${totalBodyChars}`);
  console.log(`functionEvidence field present: ${Object.hasOwn(pkg || {}, 'functionEvidence')}`);
  if (!functions.length) console.log('  (no source bodies attached; Pass 2 will rely on structural flow/schema evidence)');
  for (const item of functions) {
    const body = String(item.body || '').trim().replace(/\s+/g, ' ');
    const preview = body.length > 180 ? `${body.slice(0, 180)}…` : body;
    console.log(`  - ${item.name || item.signature || item.symbolId}`);
    console.log(`    source: ${item.sourcePath || '(unknown)'}`);
    console.log(`    body chars: ${body.length}`);
    console.log(`    preview: ${preview}`);
  }
}

console.log('\n=== PASS 2 CONTRACT ===');
console.log('function bodies are dereferenced from one selected concrete call path, never all grouped alternatives at once');
console.log('Pass 1 coherentThroughSignature selects a unique alternative when it identifies one');
console.log('if the boundary is absent or shared, Pass 2 keeps the representative path instead of expanding the group');
console.log('body text is not copied into CallPathIndexer records');
console.log('symbols without body text do not produce functionEvidence entries');
