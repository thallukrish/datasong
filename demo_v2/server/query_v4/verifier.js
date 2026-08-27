import { addUsage, arr, key, modelJson, text } from '../query_v2/modelJson.js';

const VERIFY_SYSTEM = `Verify whether the supplied evidence can ACTUALLY compute the user's requested result, not merely whether each named dimension has some field. Consider whether measures, time fields, dimensions and joins have the correct analytical relationship (for example, growth requires observations of the relevant measure over comparable time). Return JSON only: {"answerable":true|false,"reopen":[dimensionName],"anchors":[acceptedEntityName],"requirement":"short missing analytical requirement","reason":"short"}. If answerable, reopen/anchors/requirement should be empty. If not answerable, reopen MUST contain only dimension names from supplied dimensions whose current evidence is semantically insufficient or must be replaced. Do NOT reopen dimensions whose current evidence remains valid. Anchors MUST contain only supplied accepted entity names that are the best structural starting points for finding the missing evidence. Never request reconsideration of valid resolved evidence. No extra keys.`;

export async function verifyAnswerability({ question, logicalRequest, accepted, connectivity, evidencedGraph, client, model, usage, log, pass }) {
  const acceptedEntities = [...accepted.values()].filter((item) => arr(item.covered).length).map((item) => ({
    entity:item.entity,
    covered:arr(item.covered).map((coverage) => ({ dimension:coverage.dimension, field:coverage.field }))
  }));
  const payload = {
    question:text(question, 500),
    intent:text(logicalRequest?.intent, 180),
    dimensions:arr(logicalRequest?.dimensions).map((item) => item.name),
    acceptedEntities,
    connectivity:{
      connected:!!connectivity?.connected,
      paths:arr(connectivity?.paths),
      unconnected:arr(connectivity?.unconnected)
    },
    joins:arr(evidencedGraph?.joins).map((join) => ({ from:join.from, to:join.to, keyMaps:arr(join.keyMaps) }))
  };
  log('query_v4_verify_payload', { pass, payload });
  const call = await modelJson(client, model, VERIFY_SYSTEM, payload, { maxTokens:240 });
  addUsage(usage, call.usage);

  const validDimensions = new Set(payload.dimensions.map(key));
  const validEntities = new Map(acceptedEntities.map((item) => [key(item.entity), item.entity]));
  const reopen = [...new Set(arr(call.parsed?.reopen).map(String).filter((name) => validDimensions.has(key(name))))];
  const anchors = [...new Set(arr(call.parsed?.anchors).map(String).map((name) => validEntities.get(key(name))).filter(Boolean))];
  const answerable = call.parsed?.answerable === true && reopen.length === 0;
  const result = {
    answerable,
    reopen,
    anchors,
    requirement:text(call.parsed?.requirement, 220),
    reason:text(call.parsed?.reason, 320)
  };
  log('query_v4_verify_model', { pass, result, usage:call.usage, cumulativeUsage:{...usage} });
  return result;
}
