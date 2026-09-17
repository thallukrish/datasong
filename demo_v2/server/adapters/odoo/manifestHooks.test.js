import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOdooManifestHooks, extractOdooHookExecution } from './manifestHooks.js';

test('extracts post_init_hook while keeping runtime method calls out of executable hook calls', () => {
  const manifest = `{
    'name': 'Demo',
    'post_init_hook': 'post_init_hook',
  }`;
  const hooks = extractOdooManifestHooks('addons/demo/__manifest__.py', manifest, 'demo');
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].hookType, 'post_init_hook');
  assert.equal(hooks[0].functionName, 'post_init_hook');

  const source = `def post_init_hook(env):
    so1 = env['sale.order'].create({'name': 'SO1'})
    so1.action_confirm()
    env['mrp.production'].create({'product_qty': 1})
`;
  const hook = extractOdooHookExecution('addons/demo/hooks.py', source, 'demo', hooks[0]);
  assert.ok(hook);
  assert.equal(hook.functionName, 'post_init_hook');
  assert.equal(hook.executionKind, 'lifecycle_setup');
  assert.deepEqual(
    hook.calls.map((call) => [call.kind, call.modelName, call.methodName]),
    [
      ['write', 'sale.order', 'create'],
      ['write', 'mrp.production', 'create']
    ]
  );
  assert.ok(hook.lifecycleCalls.some((call) => call.kind === 'model' && call.modelName === 'sale.order' && call.methodName === 'action_confirm'));
});

test('preserves wrapped model identity as lifecycle context without exposing a runtime call edge', () => {
  const hook = {
    functionName: 'post_init_hook',
    hookType: 'post_init_hook',
    manifestPath: 'addons/example/__manifest__.py'
  };
  const source = `def post_init_hook(env):
    order = env['purchase.order'].create({'partner_id': 1})
    order.sudo().with_context(skip_check=True).button_confirm()
`;
  const parsed = extractOdooHookExecution('addons/example/hooks.py', source, 'example', hook);
  assert.ok(parsed.lifecycleCalls.some((call) => call.kind === 'model' && call.modelName === 'purchase.order' && call.methodName === 'button_confirm'));
  assert.equal(parsed.calls.some((call) => call.kind === 'model' && call.methodName === 'button_confirm'), false);
  assert.equal(parsed.lifecycleCalls.some((call) => ['sudo', 'with_context'].includes(call.methodName)), false);
});
