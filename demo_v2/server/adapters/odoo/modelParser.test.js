import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOdooModels } from './modelParser.mjs';

test('extracts a new Odoo model and relational fields', () => {
  const src = `
class BomRevision(models.Model):
    _name = "acme.bom.revision"
    _description = "EMS BOM Revision"
    bom_id = fields.Many2one("mrp.bom", required=True)
    approved_supplier_ids = fields.Many2many("res.partner")
`;
  const [model] = extractOdooModels('addons/acme/models/bom_revision.py', src, 'acme');
  assert.equal(model.name, 'acme.bom.revision');
  assert.equal(model.extension, false);
  assert.equal(model.fields[0].relatedModel, 'mrp.bom');
  assert.equal(model.fields[0].relation, 'many-to-one');
});

test('extracts an extension of a standard Odoo model', () => {
  const src = `
class MrpProduction(models.Model):
    _inherit = "mrp.production"
    ems_shortage_qty = fields.Float()
    ems_blocking_component_id = fields.Many2one("product.product")
`;
  const [model] = extractOdooModels('addons/acme/models/mrp_production.py', src, 'acme');
  assert.equal(model.name, 'mrp.production');
  assert.deepEqual(model.inherits, ['mrp.production']);
  assert.equal(model.extension, true);
});

test('captures multiple inherited models and scalar fields', () => {
  const src = `
class X(models.Model):
    _name = 'acme.x'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    code = fields.Char(required=True)
`;
  const [model] = extractOdooModels('x.py', src, 'acme');
  assert.deepEqual(model.inherits, ['mail.thread', 'mail.activity.mixin']);
  assert.equal(model.fields[0].type, 'Char');
  assert.equal(model.fields[0].required, true);
});
