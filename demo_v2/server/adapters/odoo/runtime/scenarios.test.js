import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOdooScenarioDocument } from './scenarios.js';

test('accepts enterprise Odoo UI scenarios', () => {
  const parsed = validateOdooScenarioDocument({
    enterpriseId: 'acme-ems',
    scenarios: [{
      id: 'sale-to-manufacturing',
      actor: 'sales_user',
      start: { model: 'sale.order', view: 'form' },
      actions: [
        { type: 'create', values: {} },
        { type: 'click', label: 'Confirm' }
      ]
    }]
  });
  assert.equal(parsed.enterpriseId, 'acme-ems');
  assert.equal(parsed.scenarios[0].id, 'sale-to-manufacturing');
});
