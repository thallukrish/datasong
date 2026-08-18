import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildEvidencePacket, serializeEvidenceArcPair } from '../server/evidencePacket.js';
import { normalizeStudentScores, applyStudentScores } from '../server/scorePolicy.js';
import { TrainingStore } from '../server/trainingStore.js';

function samplePacket(phase = 'pass1') {
  return buildEvidencePacket({
    phase,
    currentEvidence: {
      artifactId: 'fn:checkout.submitOrder',
      artifactType: 'function',
      canonicalContent: 'function submitOrder(cart) { persistOrder(cart); }',
      provenance: 'src/checkout.js#submitOrder'
    },
    neighbours: [
      { artifactId: 'fn:orders.persistOrder', relation: 'calls', signature: 'persistOrder(cart)' },
      { artifactId: 'fn:ui.renderToolbar', relation: 'calls', signature: 'renderToolbar()' }
    ],
    arcs: [
      {
        arcId: 'arc:sales-order',
        title: 'Sales Order',
        arcType: 'business',
        actor: 'customer',
        goal: 'place an order',
        steps: ['review cart'],
        entities: ['Order'],
        persistedObjects: ['OrderHeader'],
        outcome: 'order accepted',
        compactEvidenceSummary: 'cart review precedes order submission'
      },
      {
        arcId: 'arc:storefront-ui',
        title: 'Storefront UI',
        arcType: 'technical',
        actor: '',
        goal: 'render storefront chrome'
      }
    ],
    recentPath: ['fn:cart.reviewCart']
  });
}

test('evidence packet is canonical and inspectable', () => {
  const packet = samplePacket();
  assert.equal(packet.schemaVersion, 'datasong.evidence.v1');
  assert.equal(packet.currentEvidence.artifactId, 'fn:checkout.submitOrder');
  assert.equal(packet.neighbours.length, 2);
  assert.match(serializeEvidenceArcPair(packet, packet.arcs[0], packet.neighbours[0]), /\[CURRENT EVIDENCE\]/);
  assert.match(serializeEvidenceArcPair(packet, packet.arcs[0], packet.neighbours[0]), /\[ARC\]/);
  assert.match(serializeEvidenceArcPair(packet, packet.arcs[0], packet.neighbours[0]), /\[CANDIDATE\]/);
});

test('student scores clamp to the shared 0..1 score space', () => {
  const packet = samplePacket();
  const scores = normalizeStudentScores(packet, {
    arcScores: { 'arc:sales-order': { membership: 1.7, continuity: -1, coherence: 0.8, expectedGain: 0.9 } },
    newArcLikelihood: 0.2,
    neighbourScores: { 'fn:orders.persistOrder': 4 }
  });
  assert.equal(scores.arcScores['arc:sales-order'].membership, 1);
  assert.equal(scores.arcScores['arc:sales-order'].continuity, 0);
  assert.equal(scores.neighbourScores['fn:orders.persistOrder'], 1);
});

test('pass1 selects the strongest existing arc from student scores', () => {
  const decision = applyStudentScores(samplePacket('pass1'), {
    arcScores: {
      'arc:sales-order': { membership: 0.96, continuity: 0.9, coherence: 0.92, expectedGain: 0.88 },
      'arc:storefront-ui': { membership: 0.10, continuity: 0.12, coherence: 0.2, expectedGain: 0.1 }
    }
  });
  assert.deepEqual(decision.action.type, 'select_arc');
  assert.deepEqual(decision.action.arcId, 'arc:sales-order');
});

test('pass2 follows student neighbour ranking, not title heuristics', () => {
  const decision = applyStudentScores(samplePacket('pass2'), {
    arcScores: {
      'arc:sales-order': { membership: 0.95, continuity: 0.9, coherence: 0.9, expectedGain: 0.9 }
    },
    neighbourScores: {
      'fn:orders.persistOrder': 0.94,
      'fn:ui.renderToolbar': 0.08
    }
  });
  assert.equal(decision.action.type, 'select_neighbour');
  assert.equal(decision.action.artifactId, 'fn:orders.persistOrder');
});

test('scout can open a new business arc when novelty beats existing membership', () => {
  const decision = applyStudentScores(samplePacket('scout'), {
    arcScores: {
      'arc:sales-order': { membership: 0.15, coherence: 0.2, expectedGain: 0.2 },
      'arc:storefront-ui': { membership: 0.05, coherence: 0.1, expectedGain: 0.1 }
    },
    newArcLikelihood: 0.95,
    newBusinessUseCaseLikelihood: 0.92,
    newTechnicalUseCaseLikelihood: 0.12
  });
  assert.equal(decision.action.type, 'open_new_arc_candidate');
  assert.equal(decision.action.arcType, 'business');
});

test('training store writes rewindable JSONL episode history', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datasong-v3-'));
  const store = new TrainingStore({ root });
  const id = await store.nextEpisodeId();
  await store.append(id, { type: 'real_evidence', packet: samplePacket() });
  await store.append(id, { type: 'teacher_target', weaknesses: ['continuity_failure'] });
  const episode = await store.readEpisode(id);
  assert.equal(episode.length, 2);
  assert.equal(episode[1].weaknesses[0], 'continuity_failure');
  assert.deepEqual(await store.listEpisodes(), [1]);
});
