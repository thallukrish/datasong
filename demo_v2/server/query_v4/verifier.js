import { addUsage, arr, key, modelJson, text } from '../query_v2/modelJson.js';

const VERIFY_SYSTEM = `Verify whether the supplied evidence can ACTUALLY compute the user's requested result, not merely whether each named dimension has some field. The payload includes the intended analytical grain, required semantic relationships among dimensions, and derived calculations. Treat those requirements as the contract. Evidence is valid only when the selected fields and evidenced joins jointly satisfy that contract at a coherent analytical grain. For example, growth requires observations of the relevant measure over comparable transaction/event time; a generic unrelated date does not satisfy that relationship. Likewise product, region and measure evidence must be associated with the same sale/observation grain, not merely be structurally connected somewhere in the graph. Return JSON only: {"answerable":true|false,"reopen":[dimensionName],"anchors":[acceptedEntityName],"requirement":"short missing analytical requirement","reason":"short"}. If answerable, reopen/anchors/requirement should be empty. If not answerable, reopen MUST contain only dimension names from supplied dimensions whose current evidence is semantically insufficient or must be replaced. Do NOT reopen dimensions whose current evidence remains valid. Anchors MUST contain only supplied accepted entity names that are the best structural starting points for finding the missing evidence. Never request reconsideration of valid resolved evidence. No extra keys.`;

export async function verifyAnswerability({ question, logicalRequest, accepted, connectivity, evidencedGraph, client, model, usage, log, pass }) {
  const acceptedEntities = [...accepted.values()].filter((item) => arr(item.covered).length).map((item) => ({
    entity:item.entity,
    covered:arr(item.covered).map((coverage) => ({ dimension:coverage.dimension, field:coverage.field }))
  }));
  const payload = {
    question:text(question, 500),
    intent:text(logicalRequest?.baseIntent || logicalRequest?.intent, 220),
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
  const call = await modelJson(client, model, VERIFY_SYSTEM, payload, { maxTokens:320 });
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
