import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from '../server/runtime.js';

test('teacher/student scaffold can run one complete episode', async () => {
  await runtime.resetOrRestore();
  const started = await runtime.startEpisode();
  assert.equal(started.status, 'active');

  const packet = runtime.getEvidence();
  assert.equal(packet.schemaVersion, 'datasong.evidence.v1');
  assert.equal(packet.phase, 'pass2');

  const before = runtime.studentScore();
  assert.equal(before.neighbourScores['fixture:place-order'], 0.5);

  const teacherTarget = {
    arcScores: {
      'arc:sales-order': {
        membership: 0.98,
        continuity: 0.95,
        coherence: 0.96,
        expectedGain: 0.90
      }
    },
    neighbourScores: {
      'fixture:place-order': 0.94,
      'fixture:render-toolbar': 0.08
    },
    newArcLikelihood: 0.05,
    newBusinessUseCaseLikelihood: 0.08,
    newTechnicalUseCaseLikelihood: 0.03,
    unrelatedLikelihood: 0.02
  };

  await runtime.addTeacherSample({ target: teacherTarget, weaknesses: ['neighbour_ranking_failure'] });
  await runtime.studentTrain({ target: teacherTarget });

  const after = runtime.studentScore();
  assert.equal(after.neighbourScores['fixture:place-order'], 0.94);
  assert.equal(after.neighbourScores['fixture:render-toolbar'], 0.08);

  const decision = await runtime.applyScores(after);
  assert.equal(decision.action.type, 'select_neighbour');
  assert.equal(decision.action.artifactId, 'fixture:place-order');

  const advanced = await runtime.advance();
  assert.equal(advanced.status, 'advanced');
});
