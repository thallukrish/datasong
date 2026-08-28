import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';

const COVERAGE_SYSTEM = `Judge ACTUAL coverage for exactly ONE query requirement from the selected entity's COMPLETE supplied schema. Return JSON only: {"field":fieldIndexOrMinus1}. Return a field index ONLY when that exact supplied field directly provides data for the requested requirement. Otherwise return -1. You are seeing the complete schema for this entity, so inspect all supplied fields rather than relying on field-name proximity. Do not infer from likely related entities or possible future joins. IDs establish identity/connectivity only unless the requirement itself is that exact identifier. Quantity/count does not directly provide monetary sales amount. A time requirement requires an actual date/time field whose business meaning matches the requested event/observation time. No reasons or extra keys.`;
const REPAIR_COVERAGE_SYSTEM = `Judge ACTUAL repair coverage for exactly ONE reopened query requirement from the selected entity's COMPLETE supplied schema. Return JSON only: {"field":fieldIndexOrMinus1}. The repair requirement, locked evidence, and current evidenced path are authoritative context. Return a field index ONLY when that exact supplied field directly provides the requested reopened requirement AND semantically satisfies the stated repair requirement relative to the locked evidence. The normal direct-coverage rules still apply: repair context can narrow valid evidence but can never make an invalid primitive field valid. IDs are not dates/times or monetary measures merely because they are business-related. A time requirement requires an actual date/time field with the correct event meaning. Do not accept a generic lifecycle date when the requirement is transaction/event time. Locked evidence must remain valid and must not be reinterpreted or replaced. Structural connectivity along the supplied current path is evidenced; judge business/analytical meaning, not direct adjacency. Otherwise return -1. No reasons or extra keys.`;

function completeFields(state) {
  return arr(state?.schemaFields).map((field, index) => ({
    index,
    name:text(field?.name, 120),
    type:text(field?.type, 60),
    isPk:!!field?.isPk,
    description:text(field?.description, 180)
  })).filter((field) => field.name);
}

export async function evaluateEntityCoverage({ state, dimensions, missingDimensions, client, model, usage, log, step, repairContext = null }) {
  if (state?.type !== 'entity' || !state?.evidence) return [];
  const fields = completeFields(state);
  if (!fields.length) {
    log('query_v4_coverage_model', { step, entity:state.entityName || state.name, covered:[], skipped:'no-schema-fields', repair:!!repairContext, cumulativeUsage:{...usage} });
    return [];
  }

  const covered = [];
  for (const dimension of missingDimensions) {
    const payload = {
      dimension,
      entity:{
        name:state.evidence?.entity?.name || state.entityName || state.name,
        description:text(state.evidence?.entity?.description, 240)
      },
      fields:fields.map((field) => [field.index, field.name, field.type, field.isPk ? 1 : 0, field.description])
    };
    if (repairContext) {
      payload.repair = {
        requirement:text(repairContext.requirement, 360),
        locked:arr(repairContext.locked).map((item) => ({ entity:item.entity, dimension:item.dimension, field:item.field })),
        path:arr(repairContext.path).map((name) => text(name, 120))
      };
    }
    log('query_v4_coverage_payload', { step, entity:state.entityName || state.name, dimension, repair:!!repairContext, fullSchema:true, fieldCount:fields.length, payload });
    const call = await modelJson(client, model, repairContext ? REPAIR_COVERAGE_SYSTEM : COVERAGE_SYSTEM, payload, { maxTokens:48 });
    addUsage(usage, call.usage);
    const fieldIndex = Number(call.parsed?.field);
    const field = fields.find((item) => item.index === fieldIndex);
    if (field) covered.push({ dimension, field:field.name });
    log('query_v4_coverage_dimension', {
      step,
      entity:state.entityName || state.name,
      dimension,
      field:field?.name || '',
      repair:!!repairContext,
      fullSchema:true,
      fieldCount:fields.length,
      usage:call.usage,
      cumulativeUsage:{...usage}
    });
  }

  log('query_v4_coverage_model', { step, entity:state.entityName || state.name, covered, repair:!!repairContext, fullSchema:true, fieldCount:fields.length, cumulativeUsage:{...usage} });
  return covered;
}

export function coverageState(dimensions, accepted) {
  const covered = new Set();
  for (const item of accepted.values()) for (const dim of arr(item.covered)) covered.add(dim.dimension);
  return { covered:[...covered], missing:dimensions.filter((name) => !covered.has(name)) };
}
