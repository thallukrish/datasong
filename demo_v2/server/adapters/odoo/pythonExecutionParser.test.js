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
  assert.ok(confirm.calls.some((call) => call.kind === 'read' && call.modelName === 'stock.move' && call.methodName === 'search' && call.crud === 'read' && call.persistenceKind === 'odoo_orm'));
  assert.ok(confirm.calls.some((call) => call.kind === 'write' && call.modelName === 'mrp.production' && call.methodName === 'write' && call.crud === 'update'));

  const createMoves = parsed.methods.find((method) => method.methodName === '_create_moves');
  assert.ok(createMoves.calls.some((call) => call.kind === 'write' && call.modelName === 'stock.move' && call.methodName === 'create' && call.crud === 'create'));
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
  assert.ok(method.calls.some((call) => call.kind === 'write' && call.modelName === 'purchase.order' && call.methodName === 'create' && call.crud === 'create'));
  assert.ok(method.calls.some((call) => call.kind === 'read' && call.modelName === 'stock.move' && call.methodName === 'search' && call.crud === 'read'));
  assert.equal(method.calls.some((call) => ['with_context', 'sudo', 'with_company'].includes(call.methodName)), false);
});

test('classifies all canonical ORM CRUD operations', () => {
  const source = `
from odoo import models

class Example(models.Model):
    _name = 'example.model'

    def exercise_crud(self):
        self.env['a.model'].search([])
        self.env['b.model'].create({})
        self.env['c.model'].write({'x': 1})
        self.env['d.model'].unlink()
`;
  const parsed = extractOdooExecution('addons/example/models/example.py', source, 'example');
  const method = parsed.methods.find((item) => item.methodName === 'exercise_crud');
  assert.ok(method.calls.some((call) => call.modelName === 'a.model' && call.crud === 'read'));
  assert.ok(method.calls.some((call) => call.modelName === 'b.model' && call.crud === 'create'));
  assert.ok(method.calls.some((call) => call.modelName === 'c.model' && call.crud === 'update'));
  assert.ok(method.calls.some((call) => call.modelName === 'd.model' && call.crud === 'delete'));
});

test('extracts literal SQL CRUD targets and keeps dynamic SQL unresolved', () => {
  const source = `
from odoo import models

class Example(models.Model):
    _name = 'example.model'

    def sql_work(self):
        self.env.cr.execute("SELECT id FROM stock_quant WHERE id = 1")
        self.env.cr.execute('INSERT INTO audit_log(id) VALUES (1)')
        self._cr.execute("UPDATE stock_move SET state = 'done'")
        env.cr.execute('DELETE FROM temp_rows WHERE id = 1')
        self.env.cr.execute(query)
`;
  const parsed = extractOdooExecution('addons/example/models/example.py', source, 'example');
  const calls = parsed.methods.find((item) => item.methodName === 'sql_work').calls.filter((call) => call.kind === 'sql');
  assert.ok(calls.some((call) => call.crud === 'read' && call.persistedEntity === 'stock_quant'));
  assert.ok(calls.some((call) => call.crud === 'create' && call.persistedEntity === 'audit_log'));
  assert.ok(calls.some((call) => call.crud === 'update' && call.persistedEntity === 'stock_move'));
  assert.ok(calls.some((call) => call.crud === 'delete' && call.persistedEntity === 'temp_rows'));
  assert.ok(calls.some((call) => call.crud === '' && call.persistedEntity === ''));
});

test('recognizes relational-field method calls and explicit Python super syntax', () => {
  const source = `
from odoo import models

class ExampleOrder(models.Model):
    _inherit = 'example.order'

    def _action_confirm(self):
        self.line_ids._launch_rule()
        return super(ExampleOrder, self)._action_confirm()
`;

  const parsed = extractOdooExecution('addons/example/models/example_order.py', source, 'example');
  const method = parsed.methods.find((item) => item.methodName === '_action_confirm');
  assert.ok(method);
  assert.ok(method.calls.some((call) =>
    call.kind === 'field'
    && call.modelName === 'example.order'
    && call.fieldName === 'line_ids'
    && call.methodName === '_launch_rule'));
  assert.ok(method.calls.some((call) =>
    call.kind === 'super'
    && call.modelName === 'example.order'
    && call.methodName === '_action_confirm'));
});
