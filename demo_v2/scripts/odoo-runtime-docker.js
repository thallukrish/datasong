import path from 'node:path';
import { OdooDockerRuntimeHarness } from '../server/adapters/odoo/runtime/dockerHarness.js';

const enterpriseRepo = process.argv[2] || process.env.ACME_ODOO_REPO;
if (!enterpriseRepo) throw new Error('Provide enterprise repo as argv[2] or ACME_ODOO_REPO');

const scenarioFile = process.argv[3] || process.env.ODOO_SCENARIO_FILE || path.join(enterpriseRepo, 'lemap', 'odoo-scenarios.json');
const scenarioId = process.argv[4] || process.env.ODOO_SCENARIO_ID || '';

const harness = new OdooDockerRuntimeHarness({
  enterpriseRepo,
  scenarioFile,
  scenarioId,
  cacheRoot: path.resolve(process.cwd(), 'data', 'repo-cache')
});

console.log('[odoo-runtime] preparing instrumented runtime');
const result = await harness.run();
console.log('[odoo-runtime] scenario completed');
console.log(JSON.stringify(result, null, 2));
console.log('');
console.log('Next:');
console.log(`$env:ODOO_RUNTIME_TRACE_PATH="${result.tracePath}"`);
console.log(`node scripts/acme-pass1-handoff-assessment.js "${path.resolve(enterpriseRepo)}"`);
