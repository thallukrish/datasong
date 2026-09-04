import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedInteractionItems } from '../src/agent/interactionPlan.js';

test('interaction plan begins with goal-relevant required input rather than DOM order', () => {
  const items = [
    { semanticKey: 'language', status: 'missing', valueScope: 'application', requiredForGoal: false, goalRelevance: 0.05, priority: 1 },
    { semanticKey: 'delivery-mode', status: 'missing', valueScope: 'workflow', requiredForGoal: true, goalRelevance: 0.8, priority: 2, dependsOnSemanticKeys: ['delivery-region'] },
    { semanticKey: 'delivery-region', status: 'missing', valueScope: 'workflow', requiredForGoal: true, goalRelevance: 0.95, priority: 1, dependsOnSemanticKeys: [] }
  ];

  const ordered = orderedInteractionItems(items);
  assert.deepEqual(ordered.map((item) => item.semanticKey), ['delivery-region']);
});

test('dependent interaction becomes eligible after its dependency has a value', () => {
  const items = [
    { semanticKey: 'delivery-region', status: 'prefilled', requiredForGoal: true, goalRelevance: 0.95, priority: 1 },
    { semanticKey: 'delivery-mode', status: 'missing', requiredForGoal: true, goalRelevance: 0.8, priority: 2, dependsOnSemanticKeys: ['delivery-region'] }
  ];

  const ordered = orderedInteractionItems(items);
  assert.deepEqual(ordered.map((item) => item.semanticKey), ['delivery-mode']);
});

test('plan prefers model priority then goal relevance among ready required interactions', () => {
  const items = [
    { semanticKey: 'notes', status: 'missing', requiredForGoal: true, goalRelevance: 0.3, priority: 20 },
    { semanticKey: 'account', status: 'missing', requiredForGoal: true, goalRelevance: 0.9, priority: 10 },
    { semanticKey: 'address', status: 'missing', requiredForGoal: true, goalRelevance: 0.8, priority: 10 }
  ];
  const ordered = orderedInteractionItems(items);
  assert.deepEqual(ordered.map((item) => item.semanticKey), ['account', 'address', 'notes']);
});

test('blocked and optional irrelevant interactions are not presented as current user questions', () => {
  const items = [
    { semanticKey: 'blocked', status: 'blocked', requiredForGoal: true, goalRelevance: 1, priority: 1 },
    { semanticKey: 'theme', status: 'missing', requiredForGoal: false, goalRelevance: 0.1, priority: 1 }
  ];
  assert.deepEqual(orderedInteractionItems(items), []);
});
