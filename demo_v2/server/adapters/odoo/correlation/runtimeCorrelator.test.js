import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateOdooRuntimeTrace } from './runtimeCorrelator.js';

test('annotates Odoo symbols and call edges from runtime events', () => {
  const source = {
    id: 's1',
    name: 'odoo19:sale.order.action_confirm',
    references: [{ name: 'odoo19:sale.order._action_confirm', relation: 'calls', data: {} }],
    odooExecution: { modelName: 'sale.order', methodName: 'action_confirm', addon: 'sale' }
  };
  const target = {
    id: 's2',
    name: 'odoo19:sale.order._action_confirm',
    references: [],
    odooExecution: { modelName: 'sale.order', methodName: '_action_confirm', addon: 'sale_stock' }
  };
  const topology = { symbols: [source, target] };

  const result = correlateOdooRuntimeTrace(topology, {
    events: [
      {
        enterpriseId: 'acme-ems', scenarioId: 'sale-to-manufacturing', sessionId: 'r1',
        model: 'sale.order', method: 'action_confirm', addon: 'sale'
      },
      {
        enterpriseId: 'acme-ems', scenarioId: 'sale-to-manufacturing', sessionId: 'r1',
        model: 'sale.order', method: '_action_confirm', addon: 'sale_stock',
        callerModel: 'sale.order', callerMethod: 'action_confirm'
      }
    ]
  });

  assert.equal(result.matchedEvents, 2);
  assert.equal(result.matchedEdges, 1);
  assert.equal(target.runtimeEvidence.observed, true);
  assert.equal(source.references[0].data.runtimeEvidence.observed, true);
  assert.deepEqual(source.references[0].data.runtimeEvidence.scenarioIds, ['sale-to-manufacturing']);
});

test('bridges a static business edge across short runtime caller chains', () => {
  const source = {
    id: 's1',
    name: 'odoo19:sale.order.line._action_launch_stock_rule',
    references: [{ name: 'odoo19:stock.rule.run', relation: 'calls', data: {} }],
    odooExecution: {
      modelName: 'sale.order.line',
      methodName: '_action_launch_stock_rule',
      addon: 'sale_stock'
    }
  };
  const target = {
    id: 's2',
    name: 'odoo19:stock.rule.run',
    references: [],
    odooExecution: {
      modelName: 'stock.rule',
      methodName: 'run',
      addon: 'stock'
    }
  };
  const topology = { symbols: [source, target] };

  const result = correlateOdooRuntimeTrace(topology, {
    events: [
      {
        enterpriseId: 'acme-ems', scenarioId: 'sale-to-manufacturing', sessionId: 'r1',
        model: 'sale.order.line', method: '_action_launch_stock_rule', addon: 'sale_stock'
      },
      {
        enterpriseId: 'acme-ems', scenarioId: 'sale-to-manufacturing', sessionId: 'r1',
        model: 'procurement.group', method: 'run',
        callerModel: 'sale.order.line', callerMethod: '_action_launch_stock_rule'
      },
      {
        enterpriseId: 'acme-ems', scenarioId: 'sale-to-manufacturing', sessionId: 'r1',
        model: 'stock.rule', method: 'run', addon: 'stock',
        callerModel: 'procurement.group', callerMethod: 'run'
      }
    ]
  });

  assert.equal(result.bridgedEdges, 1);
  assert.equal(source.references[0].data.runtimeEvidence.observed, true);
  assert.equal(source.references[0].data.runtimeEvidence.bridged, true);
  assert.deepEqual(source.references[0].data.runtimeEvidence.scenarioIds, ['sale-to-manufacturing']);
});
