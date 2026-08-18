import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvidencePacket } from './evidencePacket.js';
import { applyStudentScores, normalizeStudentScores } from './scorePolicy.js';
import { TrainingStore } from './trainingStore.js';
import { RepositoryEvidenceSource } from './repositoryEvidence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = path.resolve(__dirname, '..', 'data');
const trainingStore = new TrainingStore({ root: dataRoot });

function fixturePacket() {
  return buildEvidencePacket({
    phase: 'pass2',
    currentEvidence: {
      artifactId: 'fixture:review-cart',
      artifactType: 'function',
      canonicalContent: 'function reviewCart(cart) { validateCart(cart); return renderCheckout(cart); }',
      provenance: 'demo_v3 MCP plumbing fixture'
    },
    neighbours: [
      { artifactId: 'fixture:place-order', relation: 'calls', signature: 'placeOrder(cart)' },
      { artifactId: 'fixture:render-toolbar', relation: 'calls', signature: 'renderToolbar()' }
    ],
    arcs: [{
      arcId: 'arc:sales-order', title: 'Sales Order', arcType: 'business', actor: 'Customer', goal: 'Place an order',
      steps: ['Review cart'], entities: ['Cart', 'Order'], persistedObjects: ['Order'], outcome: 'Order is submitted',
      compactEvidenceSummary: 'Customer reviews a cart before submitting an order.'
    }],
    recentPath: ['fixture:review-cart']
  });
}

const state = {
  episodeId: null,
  status: 'idle',
  packet: null,
  appliedDecision: null,
  evidenceSource: null,
  studentTargets: new Map(),
  metrics: { trainCalls: 0, scoreCalls: 0, evaluateCalls: 0 }
};

function packetKey(packet) { return `${packet.phase}:${packet.currentEvidence.artifactId}`; }

function blankScores(packet) {
  return normalizeStudentScores(packet, {
    arcScores: Object.fromEntries(packet.arcs.map((arc) => [arc.arcId, {
      membership: 0.5, continuity: 0.5, coherence: 0.5, expectedGain: 0.5
    }])),
    neighbourScores: Object.fromEntries(packet.neighbours.map((n) => [n.artifactId, 0.5])),
    newArcLikelihood: 0.5,
    newBusinessUseCaseLikelihood: 0.5,
    newTechnicalUseCaseLikelihood: 0.5,
    unrelatedLikelihood: 0.5
  });
}

export const runtime = {
  async startEpisode(input = {}) {
    const episodeId = await trainingStore.nextEpisodeId();
    state.episodeId = episodeId;
    state.status = 'active';
    state.appliedDecision = null;

    if (input.repoUrl) {
      state.evidenceSource = new RepositoryEvidenceSource();
      state.packet = await state.evidenceSource.prepare(String(input.repoUrl));
    } else {
      state.evidenceSource = null;
      state.packet = buildEvidencePacket(input.packet || fixturePacket());
    }

    await trainingStore.append(episodeId, {
      type: 'episode_started',
      evidenceMode: state.evidenceSource ? 'repository' : 'fixture',
      repository: state.evidenceSource?.snapshot?.() || undefined,
      evidencePacket: state.packet
    });
    return this.getState();
  },

  getState() {
    return {
      episodeId: state.episodeId,
      status: state.status,
      phase: state.packet?.phase || null,
      currentArtifactId: state.packet?.currentEvidence?.artifactId || null,
      repository: state.evidenceSource?.snapshot?.() || null,
      appliedDecision: state.appliedDecision,
      metrics: { ...state.metrics }
    };
  },

  getEvidence() {
    if (!state.packet) throw new Error('No active episode. Call datasong.start_episode first.');
    return state.packet;
  },

  async applyScores(scores) {
    const decision = applyStudentScores(this.getEvidence(), scores);
    state.appliedDecision = decision;
    await trainingStore.append(state.episodeId, { type: 'student_scores_applied', decision });
    return decision;
  },

  async advance() {
    if (!state.appliedDecision) throw new Error('No student decision has been applied. Call datasong.apply_scores first.');
    const priorAction = state.appliedDecision.action;

    if (state.evidenceSource) {
      state.packet = await state.evidenceSource.advance(state.appliedDecision);
      state.appliedDecision = null;
      state.status = 'active';
      await trainingStore.append(state.episodeId, {
        type: 'datasong_advanced',
        action: priorAction,
        evidencePacket: state.packet,
        repository: state.evidenceSource.snapshot()
      });
    } else {
      state.status = 'advanced';
      await trainingStore.append(state.episodeId, { type: 'datasong_advanced', action: priorAction });
    }
    return this.getState();
  },

  async resetOrRestore() {
    state.episodeId = null;
    state.status = 'idle';
    state.packet = null;
    state.appliedDecision = null;
    state.evidenceSource = null;
    return this.getState();
  },

  async getRunLog() {
    return state.episodeId ? trainingStore.readEpisode(state.episodeId) : [];
  },

  studentScore(packet = state.packet) {
    if (!packet) throw new Error('No evidence packet supplied and no active episode.');
    state.metrics.scoreCalls += 1;
    return state.studentTargets.get(packetKey(packet)) || blankScores(packet);
  },

  async addTeacherSample({ packet = state.packet, target, weaknesses = [], explanation = '' }) {
    if (!packet) throw new Error('No evidence packet supplied and no active episode.');
    const normalized = normalizeStudentScores(packet, target);
    await trainingStore.append(state.episodeId, {
      type: 'teacher_sample_added', evidencePacket: packet, teacherTarget: normalized, weaknesses, explanation
    });
    return normalized;
  },

  async addSyntheticBatch({ samples = [] }) {
    await trainingStore.append(state.episodeId, { type: 'synthetic_batch_added', samples });
    return { added: samples.length };
  },

  async studentTrain({ packet = state.packet, target }) {
    if (!packet) throw new Error('No evidence packet supplied and no active episode.');
    if (!target) throw new Error('target is required for scaffold training');
    const normalized = normalizeStudentScores(packet, target);
    state.studentTargets.set(packetKey(packet), normalized);
    state.metrics.trainCalls += 1;
    await trainingStore.append(state.episodeId, { type: 'student_trained_scaffold', loss: 0, target: normalized });
    return { mode: 'exact-target-scaffold', loss: 0, metrics: { ...state.metrics } };
  },

  studentEvaluate(packet = state.packet) {
    state.metrics.evaluateCalls += 1;
    return { scores: this.studentScore(packet), metrics: { ...state.metrics } };
  },

  getMetrics() { return { ...state.metrics, mode: 'mock-plumbing-scaffold' }; },

  async getEpisode(episodeId = state.episodeId) {
    return episodeId ? trainingStore.readEpisode(episodeId) : [];
  },

  async getLossHistory(episodeId = state.episodeId) {
    const events = await this.getEpisode(episodeId);
    return events.filter((event) => event.type === 'student_trained_scaffold')
      .map((event) => ({ timestamp: event.timestamp, loss: event.loss }));
  },

  async listCheckpoints() { return trainingStore.listCheckpoints(); },
  getSkillMetrics() { return { mode: 'not-implemented', skills: {} }; }
};
