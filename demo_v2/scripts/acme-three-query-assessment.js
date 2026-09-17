import fs from 'node:fs/promises';
import path from 'node:path';
import { ProgressiveRepositoryTopologyV9 } from '../server/progressiveRepositoryTopologyV9.js';

const arr = (value) => Array.isArray(value) ? value : [];

const requestedRepo = process.argv[2] || process.env.ACME_ODOO_REPO || path.resolve(process.cwd(), '..', '..', 'acme-ems-odoo');
const repoDir = path.resolve(requestedRepo);
const gitDir = path.join(repoDir, '.git');

try {
  const stat = await fs.stat(gitDir);
  if (!stat.isDirectory()) throw new Error('not a directory');
} catch {
  console.error(`[acme-three-query] ACME repo not found at: ${repoDir}`);
  console.error('[acme-three-query] Pass the repo path explicitly, e.g.:');
  console.error('  npm run assess:acme:queries -- C:\\path\\to\\acme-ems-odoo');
  process.exit(2);
}

const cacheRoot = path.resolve(process.cwd(), 'data', 'repo-cache');
const topology = new ProgressiveRepositoryTopologyV9({ cacheRoot });
await topology.prepare(repoDir);

function relation(modelName, fieldName, targetName) {
  const schema = topology.entitySchema(modelName);
  if (!schema) return { ok: false, detail: `${modelName} schema missing` };
  const rel = arr(schema.relationships).find((item) =>
    String(item?.title || '') === fieldName
    && String(item?.relatedEntityName || '') === targetName);
  return rel
    ? { ok: true, detail: `${modelName}.${fieldName} -> ${targetName}` }
    : { ok: false, detail: `${modelName}.${fieldName} -> ${targetName} missing` };
}

function field(modelName, fieldName) {
  const schema = topology.entitySchema(modelName);
  if (!schema) return { ok: false, detail: `${modelName} schema missing` };
  const found = arr(schema.fields).some((item) => String(item?.name || '') === fieldName);
  return found
    ? { ok: true, detail: `${modelName}.${fieldName}` }
    : { ok: false, detail: `${modelName}.${fieldName} missing` };
}

const checks = [
  ['MO to BOM', relation('mrp.production', 'bom_id', 'mrp.bom')],
  ['MO to work orders', relation('mrp.production', 'workorder_ids', 'mrp.workorder')],
  ['Work order to work center', relation('mrp.workorder', 'workcenter_id', 'mrp.workcenter')],
  ['BOM to operations', relation('mrp.bom', 'operation_ids', 'mrp.routing.workcenter')],
  ['Operation to work center', relation('mrp.routing.workcenter', 'workcenter_id', 'mrp.workcenter')],
  ['BOM to lines', relation('mrp.bom', 'bom_line_ids', 'mrp.bom.line')],
  ['BOM line to component', relation('mrp.bom.line', 'product_id', 'product.product')],
  ['Manufacturer part to internal product', relation('acme.manufacturer.part', 'product_tmpl_id', 'product.template')],
  ['Supply offer to manufacturer part', relation('acme.approved.supply', 'manufacturer_part_id', 'acme.manufacturer.part')],
  ['Supply offer to supplier', relation('acme.approved.supply', 'supplier_id', 'res.partner')],
  ['Rework to MO', relation('acme.rework.event', 'production_id', 'mrp.production')],
  ['Test result to MO', relation('acme.test.result', 'production_id', 'mrp.production')],
  ['Lot trace to MO', relation('acme.lot.trace', 'production_id', 'mrp.production')],
  ['Cost snapshot to product', relation('acme.product.cost.snapshot', 'product_id', 'product.product')],
  ['Work center actual rate', field('mrp.workcenter', 'ems_actual_units_per_day')],
  ['Work center queue', field('mrp.workcenter', 'ems_queue_units')],
  ['Work center downtime', field('mrp.workcenter', 'ems_downtime_hours_month')],
  ['MO blocking component', relation('mrp.production', 'ems_blocking_component_id', 'product.product')],
  ['MO shortage quantity', field('mrp.production', 'ems_shortage_qty')]
];

console.log('=== THREE-QUERY STRUCTURAL EVIDENCE ===');
let failed = 0;
for (const [label, check] of checks) {
  const status = check.ok ? 'PASS' : 'MISS';
  if (!check.ok) failed += 1;
  console.log(`${status} ${label}: ${check.detail}`);
}

const hooksPath = path.join(repoDir, 'addons', 'acme_ems_demo', 'hooks.py');
const hooksSource = await fs.readFile(hooksPath, 'utf8');
const expectedRates = new Map([
  ['SMT Line 1', 590],
  ['Assembly / THT', 525],
  ['AOI Inspection', 500],
  ['Functional Test Station', 342]
]);

console.log('\n=== 12K CAPACITY FIXTURE ===');
for (const [name, expectedRate] of expectedRates) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = hooksSource.match(new RegExp(`'name'\\s*:\\s*'${escaped}'[^\\n]*'ems_actual_units_per_day'\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
  const actualRate = Number(match?.[1] || NaN);
  const monthly = actualRate * 22;
  const ok = actualRate === expectedRate;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'MISS'} ${name}: ${actualRate || 'not found'} units/day x 22 = ${Number.isFinite(monthly) ? monthly : 'n/a'} units/month`);
}

const hookSymbols = arr(topology.symbols).filter((symbol) => symbol?.odooExecution?.hookType);
const executableHookEdges = hookSymbols.flatMap((symbol) =>
  arr(symbol.references)
    .filter((ref) => ref?.relation === 'calls')
    .map((ref) => `${symbol.name} -> ${ref.name}`));

console.log('\n=== ODOO LIFECYCLE BOUNDARY ===');
if (hookSymbols.length && executableHookEdges.length === 0) {
  console.log(`PASS lifecycle hooks remain evidence-only (${hookSymbols.length} hook symbol(s), no runtime call edges)`);
} else if (!hookSymbols.length) {
  failed += 1;
  console.log('MISS no lifecycle hook symbol discovered');
} else {
  failed += executableHookEdges.length;
  console.log(`MISS lifecycle hook leaked ${executableHookEdges.length} runtime call edge(s):`);
  for (const edge of executableHookEdges) console.log(`  ${edge}`);
}

console.log('\n=== DEMO QUERY DOMAINS ===');
console.log('Q1 12k production: MO/BOM/work orders/work centers + queues/rates/downtime + component shortage + quality/rework');
console.log('Q2 cost increase: product cost snapshots + supply economics + rework/scrap/freight/expedite');
console.log('Q3 MCU source switch: BOM component -> manufacturer part -> approved supply -> supplier trade-offs');

console.log('\n=== ASSESSMENT ===');
if (failed === 0) {
  console.log('PASS: static structure and seeded capacity fixtures expose the evidence domains required by all three demo queries.');
} else {
  console.log(`INCOMPLETE: ${failed} required evidence check(s) are missing or inconsistent.`);
  process.exitCode = 1;
}
