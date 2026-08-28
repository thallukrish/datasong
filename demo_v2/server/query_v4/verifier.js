import { addUsage, arr, key, modelJson, text } from '../query_v2/modelJson.js';

const VERIFY_SYSTEM = `Verify whether the supplied evidence can ACTUALLY execute the ORDERED ANSWER PLAN for the user's query, not merely whether each named concept has some field. The ordered plan steps are authoritative. The payload also includes the intended grain, required semantic relationships, derived calculations, and a connectivity result produced by LeMap.

IMPORTANT: LeMap's supplied connectivity paths and joins are structurally evidenced and authoritative. If connectivity.connected is true, DO NOT require accepted entities to have a direct edge or direct join to each other, and DO NOT reject evidence merely because a required relationship is realized through a multi-hop evidenced LeMap path. Your job is ONLY to judge whether the selected fields, when related through those authoritative LeMap paths, correctly implement the ordered answer-plan steps and preserve the required analytical grain.

Judge the plan in order. Earlier evidence may stay valid even when a later step fails. For example, if product and sales observation are correctly established but the step 'associate that same sales observation with transaction time' is not, reopen only transaction_time, not product or sales. A generic unrelated date does not satisfy a transaction/event-time step even when structurally connected. Likewise product, region and measure evidence must describe the same sale/observation grain whenever the plan requires that relationship.

Return JSON only: {"answerable":true|false,"reopen":[dimensionName],"anchors":[acceptedEntityName],"requirement":"short missing analytical requirement","reason":"short"}. If answerable, reopen/anchors/requirement should be empty. If not answerable, reopen MUST contain only supplied searchable dimension names whose current evidence is semantically insufficient for the failing plan step. Do NOT reopen dimensions whose evidence remains valid for completed earlier steps. Anchors MUST contain only supplied accepted entity names that are the best structural starting points for repairing the failing step. Never request reconsideration of valid resolved evidence. No extra keys.`;

export async function verifyAnswerability({ question, logicalRequest, accepted, connectivity, evidencedGraph, client, model, usage, log, pass }) {
  const acceptedEntities = [...accepted.values()].filter((item) => arr(item.covered).length).map((item) => ({
    entity:item.entity,
    covered:arr(item.covered).map((coverage) => ({ dimension:coverage.dimension, field:coverage.field }))
  }));
  const payload = {
    question:text(question, 500),
    intent:text(logicalRequest?.baseIntent || logicalRequest?.intent, 220),
    steps:arr(logicalRequest?.steps).map((item, index) => ({
      step:index + 1,
      action:text(item?.action, 200),
      requires:arr(item?.requires),
      relation:text(item?.relation, 200)
    })),
    grain:text(logicalRequest?.grain, 220),
    dimensions:arr(logicalRequest?.dimensions).map((item) => ({ name:item.name, role:item.role })),
    relations:arr(logicalRequest?.relations).map((item) => ({ from:item.from, relation:item.relation, to:item.to })),
    derived:arr(logicalRequest?.derived).map((item) => ({ name:item.name, expression:item.expression, dependsOn:arr(item.dependsOn) })),
    acceptedEntities,
    connectivity:{
      connected:!!connectivity?.connected,
      paths:arr(connectivity?.paths),
      unconnected:arr(connectivity?.unconnected)
    },
    joins:arr(evidencedGraph?.joins).map((join) => ({ from:join.from, to:join.to, keyMaps:arr(join.keyMaps) }))
  };
  log('query_v4_verify_payload', { pass, payload });
  const call = await modelJson(client, model, VERIFY_SYSTEM, payload, { maxTokens:360 });
  addUsage(usage, call.usage);

  const validDimensions = new Set(payload.dimensions.map((item) => key(item.name)));
  const validEntities = new Map(acceptedEntities.map((item) => [key(item.entity), item.entity]));
  const reopen = [...new Set(arr(call.parsed?.reopen).map(String).filter((name) => validDimensions.has(key(name))))];
  const anchors = [...new Set(arr(call.parsed?.anchors).map(String).map((name) => validEntities.get(key(name))).filter(Boolean))];
  const answerable = call.parsed?.answerable === true && reopen.length === 0;
  const result = {
    answerable,
    reopen,
    anchors,
    requirement:text(call.parsed?.requirement, 260),
    reason:text(call.parsed?.reason, 420)
  };
  log('query_v4_verify_model', { pass, result, usage:call.usage, cumulativeUsage:{...usage} });
  return result;
}
