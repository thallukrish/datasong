import test from 'node:test';
import assert from 'node:assert/strict';
import { OdooRpcScenarioExecutor } from './rpcExecutor.js';

test('open loads generic form metadata and record data', async () => {
  const calls = [];
  const executor = new OdooRpcScenarioExecutor({
    url: 'http://example.invalid',
    db: 'db',
    username: 'user',
    password: 'pass'
  });
  executor.executeKw = async (model, method, args, kwargs) => {
    calls.push({ model, method, args, kwargs });
    if (method === 'get_views') {
      return {
        views: {
          form: {
            arch: '<form><field name="name"/><field name="partner_id"/></form>'
          }
        },
        models: {}
      };
    }
    if (method === 'fields_get') {
      return { name: { type: 'char' }, partner_id: { type: 'many2one', relation: 'res.partner' } };
    }
    if (method === 'web_read') return [{ id: 7, name: 'Demo', partner_id: false }];
    throw new Error(`unexpected method ${method}`);
  };

  const result = await executor.open({
    model: 'x.model',
    recordIds: [7],
    action: { view: 'form' }
  });

  assert.deepEqual(result.fields, ['name', 'partner_id']);
  assert.equal(calls[0].method, 'get_views');
  assert.deepEqual(calls[0].args, [[[false, 'form']]]);
  assert.equal(calls[1].method, 'fields_get');
  assert.equal(calls[2].method, 'web_read');
  assert.deepEqual(calls[2].args[0], [7]);
  assert.deepEqual(calls[2].args[1], { name: {}, partner_id: {} });
});

test('open creation form loads defaults from fields in the resolved view', async () => {
  const calls = [];
  const executor = new OdooRpcScenarioExecutor({
    url: 'http://example.invalid',
    db: 'db',
    username: 'user',
    password: 'pass'
  });
  executor.executeKw = async (model, method, args, kwargs) => {
    calls.push({ model, method, args, kwargs });
    if (method === 'get_views') {
      return {
        views: { form: { arch: '<form><field name="name"/><field name="company_id"/></form>' } },
        models: {}
      };
    }
    if (method === 'fields_get') {
      return { name: { type: 'char' }, company_id: { type: 'many2one', relation: 'res.company' } };
    }
    if (method === 'default_get') return { company_id: 1 };
    throw new Error(`unexpected method ${method}`);
  };

  await executor.open({ model: 'x.model', recordIds: [], action: { view: 'form' } });

  assert.equal(calls[1].method, 'fields_get');
  assert.equal(calls[2].method, 'default_get');
  assert.deepEqual(calls[2].args, [['name', 'company_id']]);
});


test('open ignores nested subview fields that do not belong to the parent model', async () => {
  const calls = [];
  const executor = new OdooRpcScenarioExecutor({
    url: 'http://example.invalid',
    db: 'db',
    username: 'user',
    password: 'pass'
  });
  executor.executeKw = async (model, method, args, kwargs) => {
    calls.push({ model, method, args, kwargs });
    if (method === 'get_views') {
      return {
        views: {
          form: {
            arch: '<form><field name="name"/><field name="line_ids"><list><field name="operation_id"/></list></field></form>'
          }
        }
      };
    }
    if (method === 'fields_get') {
      return {
        name: { type: 'char' },
        line_ids: { type: 'one2many', relation: 'x.line' }
      };
    }
    if (method === 'web_read') return [{ id: 9, name: 'Parent', line_ids: [] }];
    throw new Error(`unexpected method ${method}`);
  };

  const result = await executor.open({
    model: 'x.parent',
    recordIds: [9],
    action: { view: 'form' }
  });

  assert.deepEqual(result.fields, ['name', 'line_ids']);
  assert.deepEqual(calls[2].args[1], { name: {}, line_ids: {} });
});
