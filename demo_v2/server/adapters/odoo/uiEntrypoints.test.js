import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOdooUiEntrypoints } from './uiEntrypoints.js';

test('extracts object-button method using the enclosing Odoo view model', () => {
  const xml = `<odoo>
    <record id="view_sale_order_form" model="ir.ui.view">
      <field name="model">sale.order</field>
      <field name="arch" type="xml">
        <form><header><button name="action_confirm" type="object" string="Confirm"/></header></form>
      </field>
    </record>
  </odoo>`;

  const result = extractOdooUiEntrypoints('views/sale_order.xml', xml);
  assert.deepEqual(result.entrypoints, [{
    kind: 'object_button',
    modelName: 'sale.order',
    methodName: 'action_confirm',
    sourcePath: 'views/sale_order.xml',
    line: 5
  }]);
});

test('act_window exposes a model without fabricating an executable method', () => {
  const xml = `<odoo>
    <record id="action_revision" model="ir.actions.act_window">
      <field name="res_model">acme.bom.revision</field>
      <field name="view_mode">list,form</field>
    </record>
    <menuitem id="menu_revision" action="action_revision"/>
  </odoo>`;

  const result = extractOdooUiEntrypoints('views/revision.xml', xml);
  assert.deepEqual(result.entrypoints, []);
  assert.deepEqual(result.modelActions, [{
    modelName: 'acme.bom.revision',
    actionType: 'act_window',
    sourcePath: 'views/revision.xml',
    line: 2
  }]);
});

test('extracts obvious server-action record method calls when model is explicit', () => {
  const xml = `<odoo>
    <record id="confirm_orders" model="ir.actions.server">
      <field name="model_name">purchase.order</field>
      <field name="state">code</field>
      <field name="code">records.button_confirm()</field>
    </record>
  </odoo>`;

  const result = extractOdooUiEntrypoints('data/server_actions.xml', xml);
  assert.deepEqual(result.entrypoints, [{
    kind: 'server_action',
    modelName: 'purchase.order',
    methodName: 'button_confirm',
    sourcePath: 'data/server_actions.xml',
    line: 2
  }]);
});
