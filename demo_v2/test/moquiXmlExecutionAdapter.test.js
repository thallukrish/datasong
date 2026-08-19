import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMoquiXmlExecution } from '../server/moquiXmlExecutionAdapter.js';

test('extracts Moqui screen, transitions, actions, calls and responses with nesting', () => {
  const xml = `
<screen>
  <transition name="addToCart">
    <actions>
      <service-call name="mantle.order.OrderServices.add#OrderProductQuantity"/>
    </actions>
    <default-response url="Order/Cart"/>
  </transition>
  <transition name="checkout">
    <default-response url="Order/Checkout"/>
  </transition>
</screen>`;

  const nodes = extractMoquiXmlExecution('screen/Root.xml', xml);
  assert.deepEqual(nodes.map((node) => node.tag), [
    'screen', 'transition', 'actions', 'service-call', 'default-response',
    'transition', 'default-response'
  ]);

  const [screen, addToCart, actions, serviceCall, cartResponse, checkout, checkoutResponse] = nodes;
  assert.equal(addToCart.parentOrdinal, screen.ordinal);
  assert.equal(actions.parentOrdinal, addToCart.ordinal);
  assert.equal(serviceCall.parentOrdinal, actions.ordinal);
  assert.equal(cartResponse.parentOrdinal, addToCart.ordinal);
  assert.equal(checkout.parentOrdinal, screen.ordinal);
  assert.equal(checkoutResponse.parentOrdinal, checkout.ordinal);
  assert.equal(serviceCall.attrs.name, 'mantle.order.OrderServices.add#OrderProductQuantity');
  assert.equal(cartResponse.attrs.url, 'Order/Cart');
});

test('preserves conditional children as nested executable branch evidence', () => {
  const xml = `
<screen>
  <transition name="submit">
    <actions>
      <if condition="cartEmpty">
        <service-call name="example.EmptyCart"/>
        <else><service-call name="example.PlaceOrder"/></else>
      </if>
    </actions>
  </transition>
</screen>`;
  const nodes = extractMoquiXmlExecution('screen/Order.xml', xml);
  const condition = nodes.find((node) => node.tag === 'if');
  const empty = nodes.find((node) => node.attrs.name === 'example.EmptyCart');
  const otherwise = nodes.find((node) => node.tag === 'else');
  const place = nodes.find((node) => node.attrs.name === 'example.PlaceOrder');
  assert.ok(condition && empty && otherwise && place);
  assert.equal(empty.parentOrdinal, condition.ordinal);
  assert.equal(otherwise.parentOrdinal, condition.ordinal);
  assert.equal(place.parentOrdinal, otherwise.ordinal);
});
