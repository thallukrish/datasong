import fs from 'node:fs/promises';
import path from 'node:path';

function arr(value) { return Array.isArray(value) ? value : []; }

export async function loadOdooRuntimeTrace(filePath) {
  const absolute = path.resolve(filePath);
  const text = await fs.readFile(absolute, 'utf8');
  const events = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event && typeof event === 'object') events.push(event);
    } catch (error) {
      throw new Error(`Invalid Odoo runtime trace JSON at line ${index + 1}: ${error.message}`);
    }
  }
  const enterpriseIds = [...new Set(events.map((event) => String(event.enterpriseId || '')).filter(Boolean))];
  const scenarioIds = [...new Set(events.map((event) => String(event.scenarioId || '')).filter(Boolean))];
  const sessionIds = [...new Set(events.map((event) => String(event.sessionId || '')).filter(Boolean))];
  return { filePath: absolute, events: arr(events), enterpriseIds, scenarioIds, sessionIds };
}
