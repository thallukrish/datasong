import test from 'node:test';
import assert from 'node:assert/strict';
import { assessOdooEvidence } from './evidenceAssessment.js';

test('requires runtime evidence for unresolved framework calls', () => {
  const result = assessOdooEvidence({
    uiEntrypoints: [{ kind: 'object_button', modelName: 'sale.order', methodName: 'action_confirm' }],
    projectMethodCount: 0,
    frameworkMethodCount: 4,
    unresolvedCalls: ['stock.rule.run'],
    ambiguousBoundaries: []
  });

  assert.equal(result.runtimeEvidenceRequired, true);
  assert.equal(result.evidenceLevel, 'static');
  assert.deepEqual(result.ambiguousBoundaries, ['stock.rule.run']);
});

test('field-only addon with no executable entrance reports incomplete workflow evidence', () => {
  const result = assessOdooEvidence({
    uiEntrypoints: [],
    projectMethodCount: 0,
    frameworkMethodCount: 0,
    unresolvedCalls: [],
    ambiguousBoundaries: [],
    declarativeOnly: true
  });

  assert.equal(result.runtimeEvidenceRequired, true);
  assert.match(result.runtimeEvidenceReasons.join(' '), /no executable Odoo entrypoint/i);
});

test('fully resolved static entrypoint does not require runtime evidence', () => {
  const result = assessOdooEvidence({
    uiEntrypoints: [{ kind: 'object_button', modelName: 'mrp.production', methodName: 'action_confirm' }],
    projectMethodCount: 1,
    frameworkMethodCount: 5,
    unresolvedCalls: [],
    ambiguousBoundaries: []
  });

  assert.equal(result.runtimeEvidenceRequired, false);
  assert.deepEqual(result.runtimeEvidenceReasons, []);
});
