import { addUsage, arr, modelJson } from '../query_v2/modelJson.js';
import { COVERAGE_MIN } from './pathScore.js';

const COVERAGE_SYSTEM = `Judge ACTUAL query-dimension coverage from one entity state's supplied evidence. Return JSON only: {"d":[[dimensionIndex,confidence]]}. Claim ONLY dimensions still missing and ONLY when the entity description or supplied field hints directly support them. Do not infer coverage from likely related entities or from the path. Use confidence >=0.5 for claimed coverage. No reasons, names, or extra keys.`;

export async function evaluateEntityCoverage({ state, dimensions, missingDimensions, client, model, usage, log, step }) {
  if (state?.type !== 'entity' || !state?.evidence) return [];
  const missing = new Set(missingDimensions);
  const payload = {
    d:dimensions.map((name, index) => [index, name]),
    u:dimensions.map((name, index) => missing.has(name) ? index : null).filter((v) => v !== null),
    e:state.evidence
  };
  log('query_v3_coverage_payload', { step, entity:state.entityName || state.name, payload });
  const call = await modelJson(client, model, COVERAGE_SYSTEM, payload, { maxTokens:140 });
  addUsage(usage, call.usage);
  const covered = arr(call.parsed?.d).map((pair) => {
    if (!Array.isArray(pair)) return null;
    const index = Number(pair[0]);
    const dimension = dimensions[index];
    const confidence = Math.max(0, Math.min(1, Number(pair[1] || 0)));
    return dimension && missing.has(dimension) && confidence >= COVERAGE_MIN ? { dimension, confidence } : null;
  }).filter(Boolean);
  log('query_v3_coverage_model', { step, entity:state.entityName || state.name, covered, usage:call.usage, cumulativeUsage:{...usage} });
  return covered;
}

export function coverageState(dimensions, accepted) {
  const covered = new Set();
  for (const item of accepted.values()) for (const dim of arr(item.covered)) covered.add(dim.dimension);
  return { covered:[...covered], missing:dimensions.filter((name) => !covered.has(name)) };
}
