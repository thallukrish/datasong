import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProgressiveRepositoryTopologyV7 } from './topology/progressiveRepositoryTopologyV7.js';
import { buildEvidencePacket } from './evidencePacket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cacheRoot = path.resolve(__dirname, '..', 'data', 'repo-cache');

function text(value, max = 20000) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2);
  return s.length > max ? `${s.slice(0, max)}\n…[clipped]` : s;
}

function neighbourSignature(candidate = {}) {
  return String(candidate.hint || candidate.label || candidate.path || candidate.id || '').slice(0, 4000);
}

export class RepositoryEvidenceSource {
  constructor() {
    this.topology = new ProgressiveRepositoryTopologyV7({ cacheRoot });
    this.repoUrl = '';
    this.commit = '';
    this.currentArtifactId = '';
    this.recentPath = [];
    this.arcs = [];
  }

  async prepare(repoUrl) {
    if (!repoUrl) throw new Error('repoUrl is required when starting a real repository episode');
    const prep = await this.topology.prepare(repoUrl);
    this.repoUrl = repoUrl;
    this.commit = prep.commit || '';
    this.currentArtifactId = prep.root?.id || 'dir:.';
    this.recentPath = [];
    this.arcs = [];
    return this.packetFor(prep.root || this.topology.listDirectory(''), 'scout');
  }

  packetFor(observation, phase = 'scout') {
    if (!observation?.id) throw new Error('Topology observation is missing an id');
    this.currentArtifactId = observation.id;
    if (this.recentPath.at(-1) !== observation.id) this.recentPath.push(observation.id);
    return buildEvidencePacket({
      phase,
      currentEvidence: {
        artifactId: observation.id,
        artifactType: observation.kind || 'artifact',
        canonicalContent: text(observation.canonical ?? {
          summary: observation.summary || '',
          signature: observation.signature || '',
          symbolName: observation.symbolName || ''
        }),
        provenance: text({
          repoUrl: this.repoUrl,
          commit: this.commit,
          path: observation.path || '',
          sourcePath: observation.sourcePath || '',
          lines: observation.startLine ? [observation.startLine, observation.endLine || observation.startLine] : undefined
        }, 4000)
      },
      neighbours: (Array.isArray(observation.neighbors) ? observation.neighbors : []).map((candidate) => ({
        artifactId: candidate.id,
        relation: candidate.relation || 'contains',
        signature: neighbourSignature(candidate)
      })),
      arcs: this.arcs,
      recentPath: this.recentPath.slice(-100)
    });
  }

  async advance(decision) {
    const artifactId = decision?.action?.artifactId
      || decision?.rankedNeighbours?.[0]?.artifactId
      || '';
    if (!artifactId) throw new Error(`Decision ${decision?.action?.type || 'unknown'} does not identify a next artifact`);
    const observation = await this.topology.getArtifact(artifactId);
    if (!observation) throw new Error(`Topology could not resolve artifact ${artifactId}`);
    const phase = observation.kind === 'repo_directory' || observation.kind === 'source_file_index' || observation.kind === 'xml_file'
      ? 'scout'
      : 'pass2';
    return this.packetFor(observation, phase);
  }

  snapshot() {
    return {
      repoUrl: this.repoUrl,
      commit: this.commit,
      currentArtifactId: this.currentArtifactId,
      recentPath: [...this.recentPath],
      repositoryCoverage: this.topology.repositoryCoverageSnapshot()
    };
  }
}
