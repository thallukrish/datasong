import fs from 'node:fs/promises';
import path from 'node:path';

function arr(value) { return Array.isArray(value) ? value : []; }

export function validateOdooScenarioDocument(document) {
  if (!document || typeof document !== 'object') throw new Error('Odoo scenario document must be an object');
  const enterpriseId = String(document.enterpriseId || document.enterprise || '').trim();
  if (!enterpriseId) throw new Error('Odoo scenario document requires enterpriseId');
  const scenarios = arr(document.scenarios);
  if (!scenarios.length) throw new Error('Odoo scenario document requires at least one scenario');

  const seen = new Set();
  for (const scenario of scenarios) {
    const id = String(scenario?.id || '').trim();
    if (!id) throw new Error('Every Odoo scenario requires id');
    if (seen.has(id)) throw new Error(`Duplicate Odoo scenario id: ${id}`);
    seen.add(id);
    if (!String(scenario?.actor || '').trim()) throw new Error(`Scenario ${id} requires actor`);
    if (!String(scenario?.start?.model || '').trim()) throw new Error(`Scenario ${id} requires start.model`);
    if (!arr(scenario?.actions).length) throw new Error(`Scenario ${id} requires actions`);
    for (const action of scenario.actions) {
      const type = String(action?.type || '').trim();
      if (!['open', 'create', 'edit', 'click', 'assert'].includes(type)) {
        throw new Error(`Scenario ${id} has unsupported action type: ${type || '(blank)'}`);
      }
      if (type === 'click' && !String(action?.label || action?.xmlId || '').trim()) {
        throw new Error(`Scenario ${id} click action requires label or xmlId`);
      }
    }
  }
  return { enterpriseId, scenarios };
}

export async function loadOdooScenarioDocument(filePath) {
  const absolute = path.resolve(filePath);
  const text = await fs.readFile(absolute, 'utf8');
  return { ...validateOdooScenarioDocument(JSON.parse(text)), filePath: absolute };
}
