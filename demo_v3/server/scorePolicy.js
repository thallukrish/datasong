const ARC_FIELDS = ['membership', 'continuity', 'coherence', 'expectedGain'];
const NOVELTY_FIELDS = ['newArcLikelihood', 'newBusinessUseCaseLikelihood', 'newTechnicalUseCaseLikelihood', 'unrelatedLikelihood'];

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function weighted(values) {
  let total = 0;
  let weight = 0;
  for (const [value, w] of values) {
    total += clamp01(value) * w;
    weight += w;
  }
  return weight ? total / weight : 0;
}

export function normalizeStudentScores(packet, raw = {}) {
  const arcScores = {};
  for (const arc of packet.arcs) {
    const source = raw.arcScores?.[arc.arcId] || {};
    arcScores[arc.arcId] = Object.fromEntries(ARC_FIELDS.map((field) => [field, clamp01(source[field])]));
  }

  const neighbourScores = {};
  for (const neighbour of packet.neighbours) {
    neighbourScores[neighbour.artifactId] = clamp01(raw.neighbourScores?.[neighbour.artifactId]);
  }

  const novelty = Object.fromEntries(NOVELTY_FIELDS.map((field) => [field, clamp01(raw[field] ?? raw.novelty?.[field])]));

  return {
    schemaVersion: 'datasong.student-scores.v1',
    arcScores,
    neighbourScores,
    ...novelty
  };
}

export function applyStudentScores(packet, rawScores) {
  const scores = normalizeStudentScores(packet, rawScores);

  const rankedArcs = packet.arcs.map((arc) => {
    const score = scores.arcScores[arc.arcId];
    const value = packet.phase === 'pass2'
      ? weighted([[score.continuity, 0.45], [score.coherence, 0.30], [score.expectedGain, 0.25]])
      : weighted([[score.membership, 0.50], [score.coherence, 0.25], [score.expectedGain, 0.25]]);
    return { arcId: arc.arcId, value, scores: score };
  }).sort((a, b) => b.value - a.value || a.arcId.localeCompare(b.arcId));

  const rankedNeighbours = packet.neighbours.map((neighbour) => ({
    artifactId: neighbour.artifactId,
    value: scores.neighbourScores[neighbour.artifactId]
  })).sort((a, b) => b.value - a.value || a.artifactId.localeCompare(b.artifactId));

  const bestExisting = rankedArcs[0] || null;
  const noveltyValue = weighted([
    [scores.newArcLikelihood, 0.40],
    [scores.newBusinessUseCaseLikelihood, 0.40],
    [scores.newTechnicalUseCaseLikelihood, 0.20]
  ]);

  let action;
  if (packet.phase === 'scout') {
    const existingValue = bestExisting?.value ?? 0;
    action = noveltyValue > existingValue
      ? {
          type: 'open_new_arc_candidate',
          value: noveltyValue,
          arcType: scores.newBusinessUseCaseLikelihood >= scores.newTechnicalUseCaseLikelihood ? 'business' : 'technical'
        }
      : bestExisting
        ? { type: 'continue_existing_arc', arcId: bestExisting.arcId, value: bestExisting.value }
        : { type: 'open_new_arc_candidate', value: noveltyValue, arcType: scores.newBusinessUseCaseLikelihood >= scores.newTechnicalUseCaseLikelihood ? 'business' : 'technical' };
  } else if (packet.phase === 'pass1') {
    action = bestExisting
      ? { type: 'select_arc', arcId: bestExisting.arcId, value: bestExisting.value }
      : { type: 'no_arc_available', value: 0 };
  } else {
    const bestNeighbour = rankedNeighbours[0] || null;
    action = bestNeighbour
      ? { type: 'select_neighbour', artifactId: bestNeighbour.artifactId, value: bestNeighbour.value }
      : { type: 'no_neighbour_available', value: 0 };
  }

  return {
    schemaVersion: 'datasong.semantic-decision.v1',
    phase: packet.phase,
    scores,
    rankedArcs,
    rankedNeighbours,
    noveltyValue,
    action
  };
}
