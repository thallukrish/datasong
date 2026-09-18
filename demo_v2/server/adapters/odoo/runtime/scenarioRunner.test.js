import test from 'node:test';
import assert from 'node:assert/strict';
import { OdooScenarioRunner } from './scenarioRunner.js';

test('saves created ids, finds related rows, and reuses saved ids', async () => {
  const calls = [];
  const executor = {
    async beginScenario() { return 's1'; },
    async create({ model, values }) {
      calls.push(['create', model, values]);
      return { recordIds: [10] };
    },
    async find({ model, domain, fields }) {
      calls.push(['find', model, domain, fields]);
      if (model === 'sale.order.line') return [{ id: 20, order_id: [10, 'S00010'] }];
      if (model === 'mrp.production') return [{ id: 30, sale_line_id: [20, 'SOL20'] }];
      return [];
    },
    async read() { return []; },
    async write() {},
    async callMethod() {},
    async assert() {},
    async endScenario() {},
    async lookup() { throw new Error('fixture lookup not expected'); }
  };
  const uiResolver = {
    async resolveClick() { return { methodName: 'action_confirm' }; }
  };
  executor.callMethod = async ({ model, recordIds, methodName }) => {
    calls.push(['call', model, recordIds, methodName]);
  };

  const runner = new OdooScenarioRunner({ executor, uiResolver });
  const result = await runner.runScenario({
    enterpriseId: 'acme-ems',
    scenario: {
      id: 'runtime-state',
      start: { model: 'sale.order', view: 'form' },
      actions: [
        { type: 'create', saveAs: 'so_id', values: { name: 'x' } },
        { type: 'click', label: 'Confirm' },
        { type: 'find', model: 'sale.order.line', domain: [['order_id', '=', { $saved: 'so_id' }]], saveAs: 'line_ids', many: true },
        { type: 'find', model: 'mrp.production', domain: [['sale_line_id', 'in', { $saved: 'line_ids' }]], saveAs: 'mo_ids', many: true }
      ]
    }
  });

  assert.equal(result.saved.so_id, 10);
  assert.deepEqual(result.saved.line_ids, [20]);
  assert.deepEqual(result.saved.mo_ids, [30]);
  assert.deepEqual(calls[2][2], [['order_id', '=', 10]]);
  assert.deepEqual(calls[3][2], [['sale_line_id', 'in', [20]]]);
});


test('open can switch models using saved record ids without carrying stale ids', async () => {
  const opens = [];
  const executor = {
    async beginScenario() { return 's2'; },
    async create() { return { recordIds: [11] }; },
    async find({ model }) {
      if (model === 'x.related') return [{ id: 42 }];
      return [];
    },
    async open(args) { opens.push(args); },
    async read() { return []; },
    async write() {},
    async callMethod() {},
    async assert() {},
    async endScenario() {},
    async lookup() { throw new Error('fixture lookup not expected'); }
  };
  const uiResolver = { async resolveClick() { return null; } };
  const runner = new OdooScenarioRunner({ executor, uiResolver });

  const result = await runner.runScenario({
    enterpriseId: 'generic-enterprise',
    scenario: {
      id: 'generic-open',
      start: { model: 'x.source', view: 'form' },
      actions: [
        { type: 'create', saveAs: 'source_id', values: { name: 'source' } },
        { type: 'find', model: 'x.related', domain: [], saveAs: 'related_id' },
        { type: 'open', model: 'x.related', recordId: { $saved: 'related_id' } },
        { type: 'open', model: 'x.other' }
      ]
    }
  });

  assert.deepEqual(opens[0].recordIds, [42]);
  assert.equal(opens[0].model, 'x.related');
  assert.deepEqual(opens[1].recordIds, []);
  assert.equal(opens[1].model, 'x.other');
  assert.equal(result.saved.related_id, 42);
});
