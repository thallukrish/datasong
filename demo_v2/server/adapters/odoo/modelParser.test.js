import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOdooModels } from './modelParser.js';

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

test('extracts relational comodel from Odoo comodel_name keyword argument', () => {
  const src = `
class SaleOrder(models.Model):
    _name = 'sale.order'
    order_line = fields.One2many(
        comodel_name='sale.order.line',
        inverse_name='order_id',
        string='Order Lines',
    )
`;
  const [model] = extractOdooModels('addons/sale/models/sale_order.py', src, 'sale');
  assert.equal(model.fields[0].name, 'order_line');
  assert.equal(model.fields[0].relatedModel, 'sale.order.line');
  assert.equal(model.fields[0].relation, 'one-to-many');
});

test('does not mistake a related field path for an explicit relational comodel', () => {
  const src = `
class MrpProduction(models.Model):
    _name = 'mrp.production'
    product_variant_attributes = fields.Many2many(related='product_id.product_template_attribute_value_ids')
    lot_ids = fields.Many2many(
        'stock.lot',
        string='Lots',
    )
`;
  const [model] = extractOdooModels('addons/mrp/models/mrp_production.py', src, 'mrp');
  assert.equal(model.fields[0].relatedModel, '');
  assert.equal(model.fields[1].relatedModel, 'stock.lot');
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
