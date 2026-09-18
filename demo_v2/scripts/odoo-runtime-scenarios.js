import fs from 'node:fs/promises';
import path from 'node:path';
import { loadOdooScenarioDocument } from '../server/adapters/odoo/runtime/scenarios.js';
import { OdooScenarioRunner } from '../server/adapters/odoo/runtime/scenarioRunner.js';
import { OdooRpcScenarioExecutor } from '../server/adapters/odoo/runtime/rpcExecutor.js';
import { OdooXmlUiResolver } from '../server/adapters/odoo/runtime/viewResolver.js';

async function walkXml(root) {
  const out = [];
  const visit = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && entry.name.endsWith('.xml')) {
        out.push({
          sourcePath: path.relative(root, full).replace(/\\/g, '/'),
          xml: await fs.readFile(full, 'utf8').catch(() => '')
        });
      }
    }
  };
  await visit(root);
  return out;
}

const scenarioPath = process.argv[2] || process.env.ODOO_SCENARIO_FILE;
if (!scenarioPath) throw new Error('Provide scenario file path as argv[2] or ODOO_SCENARIO_FILE');

const viewRoots = String(process.env.ODOO_VIEW_ROOTS || '')
  .split(path.delimiter)
  .map((value) => value.trim())
  .filter(Boolean);

const document = await loadOdooScenarioDocument(scenarioPath);
const sources = [];
for (const root of viewRoots) sources.push(...await walkXml(path.resolve(root)));
const uiResolver = OdooXmlUiResolver.fromSources(sources);

const executor = new OdooRpcScenarioExecutor({
  url: process.env.ODOO_URL || 'http://localhost:8069',
  db: process.env.ODOO_DB || 'odoo',
  username: process.env.ODOO_USERNAME || 'admin',
  password: process.env.ODOO_PASSWORD || 'admin',
  sessionId: process.env.LEMAP_SESSION_ID || ''
});

const runner = new OdooScenarioRunner({ executor, uiResolver });
for (const scenario of document.scenarios) {
  console.log(`[odoo-runtime] scenario ${scenario.id}`);
  const result = await runner.runScenario({ enterpriseId: document.enterpriseId, scenario });
  console.log(JSON.stringify(result));
}
