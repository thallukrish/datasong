import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOdooExecution } from './pythonExecutionParser.js';

test('extracts Odoo model methods and execution call kinds', () => {
  const source = `
from odoo import models

class MrpProduction(models.Model):
    _inherit = 'mrp.production'

    def action_confirm(self):
        moves = self.env['stock.move'].search([])
        result = super().action_confirm()
        self._create_moves()
        self.write({'state': 'progress'})
        return result

    def _create_moves(self):
        self.env['stock.move'].create({})
`;

  const parsed = extractOdooExecution('addons/acme/models/mrp_production.py', source, 'acme');
  assert.equal(parsed.models.length, 1);
  assert.equal(parsed.models[0].name, 'mrp.production');

  const confirm = parsed.methods.find((method) => method.methodName === 'action_confirm');
  assert.ok(confirm);
  assert.equal(confirm.modelName, 'mrp.production');
  assert.ok(confirm.calls.some((call) => call.kind === 'super' && call.methodName === 'action_confirm'));
  assert.ok(confirm.calls.some((call) => call.kind === 'self' && call.methodName === '_create_moves'));
  assert.ok(confirm.calls.some((call) => call.kind === 'read' && call.modelName === 'stock.move' && call.methodName === 'search'));
  assert.ok(confirm.calls.some((call) => call.kind === 'write' && call.modelName === 'mrp.production' && call.methodName === 'write'));

  const createMoves = parsed.methods.find((method) => method.methodName === '_create_moves');
  assert.ok(createMoves.calls.some((call) => call.kind === 'write' && call.modelName === 'stock.move' && call.methodName === 'create'));
});

test('keeps model identity through common Odoo recordset-preserving chains', () => {
  const source = `
from odoo import models

class StockPicking(models.Model):
    _inherit = 'stock.picking'

    def process(self):
        self.with_context(skip_backorder=True).button_validate()
        self.sudo().with_company(self.company_id)._action_done()
        self.env['purchase.order'].with_company(self.company_id).create({'partner_id': 1})
        self.env['stock.move'].sudo().search([])
`;

  const parsed = extractOdooExecution('addons/example/models/stock_picking.py', source, 'example');
  const method = parsed.methods.find((item) => item.methodName === 'process');
  assert.ok(method);
  assert.ok(method.calls.some((call) => call.kind === 'self' && call.modelName === 'stock.picking' && call.methodName === 'button_validate'));
  assert.ok(method.calls.some((call) => call.kind === 'self' && call.modelName === 'stock.picking' && call.methodName === '_action_done'));
  assert.ok(method.calls.some((call) => call.kind === 'write' && call.modelName === 'purchase.order' && call.methodName === 'create'));
  assert.ok(method.calls.some((call) => call.kind === 'read' && call.modelName === 'stock.move' && call.methodName === 'search'));
  assert.equal(method.calls.some((call) => ['with_context', 'sudo', 'with_company'].includes(call.methodName)), false);
});
