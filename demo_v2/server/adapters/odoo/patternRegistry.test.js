import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOdooPatterns, fileMatches, odooPatternRules } from './patternRegistry.js';

test('matches configured Odoo files with simple glob selectors', () => {
  assert.equal(fileMatches('addons/acme/__manifest__.py', ['**/__manifest__.py']), true);
  assert.equal(fileMatches('__manifest__.py', ['__manifest__.py']), true);
  assert.equal(fileMatches('addons/acme/views/order.xml', ['**/*.xml']), true);
  assert.equal(fileMatches('order.xml', ['*.xml']), true);
  assert.equal(fileMatches('addons/acme/models/order.py', ['**/*.xml']), false);
});

test('matches manifest lifecycle hooks with either quote style and whitespace', () => {
  const source = `{
    "name": "Demo",
    'post_init_hook'   :   "post_init_hook"
  }`;
  const matches = applyOdooPatterns('addons/demo/__manifest__.py', source, { ids: ['manifest_lifecycle_hook'] });
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].captures, { hookType: 'post_init_hook', function: 'post_init_hook' });
});

test('matches multiline XML object buttons regardless of attribute order', () => {
  const source = `
<odoo>
  <button
      string="Confirm"
      name='action_confirm'
      class="oe_highlight"
      type = "object"
  />
</odoo>`;
  const matches = applyOdooPatterns('addons/sale/views/order.xml', source, { ids: ['xml_object_button'] });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].captures.method, 'action_confirm');
});

test('matches env and self.env direct model calls with flexible whitespace', () => {
  const source = `
order = env [ 'sale.order' ] . create(vals)
self.env["mrp.production"].search([])
`;
  const matches = applyOdooPatterns('addons/demo/hooks.py', source, { ids: ['python_env_model_call'] });
  assert.deepEqual(matches.map((item) => item.captures), [
    { model: 'sale.order', method: 'create' },
    { model: 'mrp.production', method: 'search' }
  ]);
});

test('maps Odoo model declarations to generic entity evidence', () => {
  const source = `
class SaleOrder(models.Model):
    _name = "x.sale.order"
    _inherit   =   'sale.order'
`;
  const matches = applyOdooPatterns('addons/demo/models/sale_order.py', source, {
    ids: ['python_model_name', 'python_model_inherit']
  });
  assert.deepEqual(matches.map((item) => [item.emit.kind, item.emit.relation, item.captures.model]), [
    ['entity', 'declares', 'x.sale.order'],
    ['entity', 'extends', 'sale.order']
  ]);
});

test('registry is data-driven and exposes rule metadata', () => {
  const rules = odooPatternRules();
  assert.ok(rules.some((rule) => rule.id === 'python_super_call'));
  assert.ok(rules.some((rule) => rule.id === 'python_model_inherit' && rule.emit?.relation === 'extends'));
});
