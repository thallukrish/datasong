import { ProgressiveRepositoryExplorerV17 } from './progressiveRepositoryExplorerV17.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function cleanRepoPath(value = '') {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export class ProgressiveRepositoryExplorerV18 extends ProgressiveRepositoryExplorerV17 {
  normalizeTypedArtifactRequest(request, observation, candidates = []) {
    if (!request || typeof request !== 'object') return request;
    const id = String(request.artifactId || '').trim();
    if (!id) return request;

    const candidate = arr(candidates).find((item) => item?.id === id);
    const isXmlNode = id.startsWith('xmlnode:') || candidate?.kind === 'xml_node';
    const rawPath = cleanRepoPath(id.replace(/^file:/, ''));
    const isRepositoryFile = id.startsWith('file:') || this.topology.trackedFiles?.includes(rawPath);

    // XML hierarchy nodes are artifacts, not semantic functions. Expanding one
    // means getArtifact(nodeId), regardless of whether the model happened to
    // spell the operation as getFunction/getNeighbors.
    if (isXmlNode && ['getFunction', 'getNeighbors'].includes(request.type)) {
      request.type = 'getArtifact';
      request._normalizedTypedOperation = 'xmlNodeToArtifact';
      return request;
    }

    // Files do not have semantic-function neighborhoods. If the model asks for
    // getNeighbors/getFunction on a repository file, normalize to inspecting
    // that file as an artifact. This is repository mechanics, not semantics.
    if (isRepositoryFile && ['getFunction', 'getNeighbors'].includes(request.type)) {
      request.type = 'getArtifact';
      request.artifactId = id.startsWith('file:') ? id : `file:${rawPath}`;
      request._normalizedTypedOperation = 'fileToArtifact';
    }
    return request;
  }

  compactXmlCanonical(canonical = {}) {
    if (canonical.kind === 'xml_hierarchy' || canonical.kind === 'jmeter_xml_hierarchy') {
      return {
        kind: canonical.kind,
        path: canonical.path,
        roots: arr(canonical.roots).map((root) => ({
          id: root.id,
          tag: root.tag,
          attributes: root.attributes,
          childCount: root.childCount,
          childTags: root.childTags
        })),
        note: 'Immediate children are supplied once as candidate signatures.'
      };
    }

    if (canonical.kind === 'xml_hierarchy_node') {
      return {
        kind: canonical.kind,
        source: canonical.source,
        node: canonical.node,
        structuredUnits: canonical.structuredUnits,
        note: 'Immediate children are supplied once as candidate signatures.'
      };
    }
    return canonical;
  }

  buildPrompt(observation, candidates) {
    if (observation?.kind !== 'xml_file') return super.buildPrompt(observation, candidates);

    // V17 already has the compact non-additive artifact prompt. Feed it a view
    // of the current XML node that does not duplicate every child both inside
    // CURRENT and again in CANDIDATES.
    const compactObservation = {
      ...observation,
      canonical: this.compactXmlCanonical(observation.canonical || {})
    };
    return super.buildPrompt(compactObservation, candidates);
  }

  validateBrowseRequest(request, observation, candidates) {
    this.normalizeTypedArtifactRequest(request, observation, candidates);

    // xmlnode:* ids are canonical artifacts managed by the lazy XML hierarchy.
    // They need not also exist in symbolById and may be selected from CURRENT
    // hierarchy evidence even when not repeated in the candidate list.
    if (request?.type === 'getArtifact' && String(request.artifactId || '').startsWith('xmlnode:')) {
      const known = this.topology.xmlNodeById?.has(request.artifactId)
        || arr(candidates).some((candidate) => candidate?.id === request.artifactId);
      if (!known) throw new Error('getArtifact xmlnode artifactId must identify known XML hierarchy evidence');
      return;
    }

    return super.validateBrowseRequest(request, observation, candidates);
  }

  async resolveNextAction(action, candidates) {
    this.normalizeTypedArtifactRequest(action, null, candidates);
    return super.resolveNextAction(action, candidates);
  }
}
