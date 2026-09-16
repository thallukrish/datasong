import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOdooManifestHooks, extractOdooHookExecution } from './manifestHooks.js';

test('extracts post_init_hook from Odoo manifest and resolves model-bound method calls', () => {
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
  assert.deepEqual(
    hook.calls.map((call) => [call.kind, call.modelName, call.methodName]),
    [
      ['write', 'sale.order', 'create'],
      ['write', 'mrp.production', 'create'],
      ['model', 'sale.order', 'action_confirm']
    ]
  );
});
