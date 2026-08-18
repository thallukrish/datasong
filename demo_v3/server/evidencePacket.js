function text(value, max = 20000) {
  const s = String(value ?? '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function compactList(value, maxItems = 100) {
  return (Array.isArray(value) ? value : []).slice(0, maxItems);
}

function normalizeEvidence(evidence = {}) {
  return {
    artifactId: text(evidence.artifactId, 1000),
    artifactType: text(evidence.artifactType, 120),
    canonicalContent: text(evidence.canonicalContent),
    provenance: text(evidence.provenance, 4000)
  };
}

function normalizeNeighbour(neighbour = {}) {
  return {
    artifactId: text(neighbour.artifactId, 1000),
    relation: text(neighbour.relation, 120),
    signature: text(neighbour.signature, 4000)
  };
}

function normalizeArc(arc = {}) {
  return {
    arcId: text(arc.arcId, 1000),
    title: text(arc.title, 500),
    arcType: arc.arcType === 'technical' ? 'technical' : 'business',
    actor: text(arc.actor, 1000),
    goal: text(arc.goal, 2000),
    steps: compactList(arc.steps, 100).map((step) => text(step, 2000)),
    entities: compactList(arc.entities, 100).map((entity) => text(entity, 1000)),
    persistedObjects: compactList(arc.persistedObjects, 100).map((item) => text(item, 1000)),
    outcome: text(arc.outcome, 2000),
    compactEvidenceSummary: text(arc.compactEvidenceSummary, 6000)
  };
}

export function buildEvidencePacket(input = {}) {
  const phase = ['scout', 'pass1', 'pass2'].includes(input.phase) ? input.phase : 'scout';
  const currentEvidence = normalizeEvidence(input.currentEvidence);
  if (!currentEvidence.artifactId) throw new Error('currentEvidence.artifactId is required');

  return {
    schemaVersion: 'datasong.evidence.v1',
    phase,
    currentEvidence,
    neighbours: compactList(input.neighbours, 250)
      .map(normalizeNeighbour)
      .filter((item) => item.artifactId),
    arcs: compactList(input.arcs, 100)
      .map(normalizeArc)
      .filter((item) => item.arcId),
    recentPath: compactList(input.recentPath, 100).map((item) => text(item, 1000)),
    priorScores: input.priorScores && typeof input.priorScores === 'object' ? input.priorScores : {}
  };
}

export function serializeEvidenceArcPair(packet, arc = null, candidate = null) {
  const lines = [
    `[PHASE]\n${packet.phase}`,
    `[CURRENT EVIDENCE]\nartifactId: ${packet.currentEvidence.artifactId}\ntype: ${packet.currentEvidence.artifactType}\nprovenance: ${packet.currentEvidence.provenance}\ncontent:\n${packet.currentEvidence.canonicalContent}`
  ];

  if (arc) {
    lines.push(`[ARC]\narcId: ${arc.arcId}\ntype: ${arc.arcType}\ntitle: ${arc.title}\nactor: ${arc.actor}\ngoal: ${arc.goal}\nsteps: ${arc.steps.join(' -> ')}\nentities: ${arc.entities.join(', ')}\npersisted objects: ${arc.persistedObjects.join(', ')}\noutcome: ${arc.outcome}\nevidence: ${arc.compactEvidenceSummary}`);
  }

  if (candidate) {
    lines.push(`[CANDIDATE]\nartifactId: ${candidate.artifactId}\nrelation: ${candidate.relation}\nsignature: ${candidate.signature}`);
  }

  if (packet.recentPath.length) lines.push(`[RECENT PATH]\n${packet.recentPath.join(' -> ')}`);
  return lines.join('\n\n');
}
