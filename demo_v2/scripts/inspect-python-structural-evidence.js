import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProgressiveRepositoryTopologyV9 } from '../server/progressiveRepositoryTopologyV9.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataRoot = path.join(root, 'data');

const repoUrl = String(process.argv[2] || '').trim();
const commit = String(process.argv[3] || '').trim();

if (!repoUrl) {
  console.error('Usage: node scripts/inspect-python-structural-evidence.js <repo-url> [commit]');
  process.exit(2);
}

const topology = new ProgressiveRepositoryTopologyV9({
  cacheRoot: path.join(dataRoot, 'repo-cache')
});
if (commit) topology.targetCommit = commit;

const prepared = await topology.prepare(repoUrl);
const nodes = Array.isArray(topology.structuralEvidenceNodes) ? topology.structuralEvidenceNodes : [];
const entities = nodes
  .filter((node) => node?.type === 'entity')
  .sort((a, b) => Number(b.details?.coreScore || 0) - Number(a.details?.coreScore || 0));
const workflows = nodes
  .filter((node) => node?.type === 'workflow')
  .sort((a, b) => Number(b.details?.functionCount || 0) - Number(a.details?.functionCount || 0));

console.log(JSON.stringify({
  repoUrl,
  commit: prepared.commit || topology.commit || '',
  pythonAst: prepared.pythonAst || null,
  structuralEvidence: prepared.structuralEvidence || null,
  topEntities: entities.slice(0, 30).map((node) => ({
    id: node.id,
    name: node.details?.name || '',
    kind: node.details?.kind || '',
    functionCount: Number(node.details?.functionCount || 0),
    flowEdgeCount: Number(node.details?.flowEdgeCount || 0),
    coreScore: Number(node.details?.coreScore || 0),
    aliases: node.details?.aliases || [],
    origins: node.details?.origins || [],
    members: node.details?.members || [],
    keys: node.details?.keys || []
  })),
  topWorkflows: workflows.slice(0, 20).map((node) => ({
    id: node.id,
    callPathId: node.details?.callPathId || '',
    functionCount: Number(node.details?.functionCount || 0),
    entityCount: Number(node.details?.entityCount || 0),
    entryFunctionId: node.details?.entryFunctionId || '',
    exitFunctionId: node.details?.exitFunctionId || ''
  }))
}, null, 2));
