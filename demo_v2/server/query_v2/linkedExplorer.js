import { addUsage, arr, key, modelJson, text } from './modelJson.js';
import { compactOptions, compactPath, filterHierarchyForEntities } from './semanticHierarchy.js';

const SCORE_SYSTEM = `Navigate ONLY the supplied hierarchy of directly linked, still-eligible entities. Return SPARSE compact JSON only: {"c":[{"id":"exact visible id","d":{"exact supplied dimension":0.0}}],"r":["exact visible id"]}. Put in c EVERY visible option that may matter at all, even weakly, with only dimensions having confidence > 0. Omit irrelevant dimensions. Put in r ONLY options whose supplied name+description is sufficient to explicitly rule out this linked branch. Never reject because another option scores higher. Any visible option omitted from both c and r remains new/unassessed and eligible. Do not include reasons, names, decision strings, or zero-confidence dimensions.`;
const EDGE_SYSTEM = `You are considering one direct evidenced schema link from an accepted entity to a new linked entity. Use the target name and exact join evidence only. Return {"decision":"follow|alternative|reject","dimensions":[{"dimension":"exact supplied dimension","confidence":0.0}],"reason":"short"}. follow means push the target into DFS now; alternative means keep it available but try another linked path first; reject means this linked entity itself is not useful for the query. Never invent joins.`;

function confidence(dimensions) {
  return Math.max(0, ...arr(dimensions).map((item) => Number(item?.confidence || 0)));
}
function fmtDims(dimensions) {
  return arr(dimensions).map((item) => `${item.dimension}=${Number(item.confidence || 0).toFixed(2)}`).join(', ') || '-';
}
function fmtPath(path) {
  return arr(path).map((part) => part.name || part).filter(Boolean).join(' → ') || 'LINK ROOT';
}

function normalizeDimensions(items, allowed) {
  const allowedByKey = new Map(arr(allowed).map((name) => [key(name), name]));
  return arr(items).map((item) => ({
    dimension:allowedByKey.get(key(item?.dimension)) || '',
    confidence:Math.max(0, Math.min(1, Number(item?.confidence || 0)))
  })).filter((item) => item.dimension);
}

function dimensionsFromSparse(value, allowed) {
  const allowedByKey = new Map(arr(allowed).map((name) => [key(name), name]));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).map(([name, score]) => ({
    dimension:allowedByKey.get(key(name)) || '',
    confidence:Math.max(0, Math.min(1, Number(score || 0)))
  })).filter((item) => item.dimension && item.confidence > 0);
}

function normalizeAssessments(parsed, options, dimensions) {
  const visible = new Map(arr(options).map((option) => [String(option.id), option]));
  const returned = new Map();

  for (const item of arr(parsed?.c)) {
    const id = String(item?.id || '');
    if (!visible.has(id) || returned.has(id)) continue;
    const dims = dimensionsFromSparse(item?.d, dimensions);
    returned.set(id, {
      id,
      name:visible.get(id).name,
      decision:'candidate',
      dimensions:dims,
      confidence:confidence(dims)
    });
  }
  for (const rawId of arr(parsed?.r)) {
    const id = String(rawId || '');
    if (!visible.has(id) || returned.has(id)) continue;
    returned.set(id, { id, name:visible.get(id).name, decision:'reject', dimensions:[], confidence:0 });
  }

  // Backward compatibility for old verbose responses.
  for (const item of arr(parsed?.assessments)) {
    const id = String(item?.id || '');
    if (!visible.has(id) || returned.has(id)) continue;
    const dims = normalizeDimensions(item?.dimensions, dimensions);
    returned.set(id, {
      id,
      name:visible.get(id).name,
      decision:item?.decision === 'reject' ? 'reject' : 'candidate',
      dimensions:dims,
      confidence:confidence(dims)
    });
  }

  return arr(options).map((option) => returned.get(String(option.id)) || {
    id:option.id,
    name:option.name,
    decision:'candidate',
    dimensions:[],
    confidence:0
  });
}

function ranked(items) {
  return arr(items).filter((item) => item.decision === 'candidate')
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

function pathForNode(nodeId, hierarchy) {
  const path = [];
  let id = nodeId;
  while (id) {
    const node = hierarchy.byId.get(id);
    if (!node) break;
    path.push({ id:node.id, type:node.type, name:node.name });
    id = hierarchy.parentById.get(id);
  }
  return path.reverse();
}

function compactTrail(stack) {
  return stack.map((frame) => ({
    current:frame.current ? { id:frame.current.id, name:frame.current.name, score:frame.current.confidence } : null,
    alternatives:arr(frame.alternatives).map((item) => ({ id:item.id, name:item.name, score:item.confidence }))
  }));
}

function joinSummary(joins) {
  return arr(joins).map((join) => ({
    from:join.from,
    to:join.to,
    relationship:join.relationship,
    cardinality:join.cardinality,
    keyMaps:join.keyMaps
  }));
}

function callTrace(step, phase, callUsage, usage) {
  console.log(`[lemap query-v2][LINK ${step}] ${phase} tokens: prompt ${callUsage.prompt} | output ${callUsage.completion} | call ${callUsage.total} | cumulative ${usage.total}`);
}
function choiceTrace(step, path, assessments) {
  const candidates = ranked(assessments);
  console.log(`[lemap query-v2][LINK ${step}] PATH ${fmtPath(path)}`);
  if (candidates[0]) console.log(`  CURRENT: ${candidates[0].name} | ${fmtDims(candidates[0].dimensions)} | score ${candidates[0].confidence.toFixed(2)}`);
  for (const item of candidates.slice(1)) console.log(`  ALT: ${item.name} | ${fmtDims(item.dimensions)} | score ${item.confidence.toFixed(2)}`);
  for (const item of assessments.filter((entry) => entry.decision === 'reject')) console.log(`  REJECT: ${item.name}`);
}

async function score({ question, dimensions, sourceEntity, path, options, trail, globalContext, client, model, log, usage, step }) {
  const payload = {
    task:'linked_entity_hierarchy_score',
    question,
    dimensions,
    sourceEntity,
    currentPath:compactPath(path),
    visibleOptions:compactOptions(options),
    linkTrail:compactTrail(trail),
    globalContext
  };
  log('query_v2_link_payload', { step, phase:'score', payload });
  const call = await modelJson(client, model, SCORE_SYSTEM, payload, { maxTokens:800 });
  addUsage(usage, call.usage);
  callTrace(step, 'SCORE', call.usage, usage);
  const assessments = normalizeAssessments(call.parsed, options, dimensions);
  choiceTrace(step, path, assessments);
  log('query_v2_link_model', { step, phase:'score', assessments, usage:call.usage, cumulativeUsage:{ ...usage } });
  return assessments;
}

async function inspectEdge({ question, dimensions, sourceEntity, targetEntity, joins, globalContext, client, model, log, usage, step }) {
  const payload = {
    task:'linked_entity_edge_decision',
    question,
    dimensions,
    sourceEntity,
    targetEntity,
    joins:joinSummary(joins),
    globalContext
  };
  log('query_v2_link_payload', { step, phase:'edge', payload });
  const call = await modelJson(client, model, EDGE_SYSTEM, payload, { maxTokens:500 });
  addUsage(usage, call.usage);
  callTrace(step, 'EDGE', call.usage, usage);
  const dims = normalizeDimensions(call.parsed?.dimensions, dimensions);
  const result = {
    decision:['follow','alternative','reject'].includes(call.parsed?.decision) ? call.parsed.decision : 'alternative',
    dimensions:dims,
    confidence:confidence(dims),
    reason:text(call.parsed?.reason, 100)
  };
  log('query_v2_link_model', { step, phase:'edge', sourceEntity, targetEntity, result, usage:call.usage, cumulativeUsage:{ ...usage } });
  return result;
}

export async function exploreLinkedEntities({
  question,
  dimensions,
  sourceEntity,
  eligibleLinks,
  hierarchy,
  excludedNodeIds = new Set(),
  globalContext,
  client,
  model,
  log,
  usage,
  startStep = 0
}) {
  const byEntity = new Map(arr(eligibleLinks).map((item) => [key(item.entity), item]));
  const linkedHierarchy = filterHierarchyForEntities(hierarchy, arr(eligibleLinks).map((item) => item.entity), excludedNodeIds);
  const rejectedEntityKeys = new Set();
  const deferred = [];
  const stack = [];
  let step = startStep;

  if (!linkedHierarchy.clusters.length) return { choice:null, rejectedEntityKeys, step };

  let options = linkedHierarchy.clusters;
  let path = [];
  while (options.length) {
    const assessments = await score({
      question, dimensions, sourceEntity, path, options, trail:stack, globalContext,
      client, model, log, usage, step:++step
    });
    const candidates = ranked(assessments);
    if (!candidates.length) break;
    const frame = { current:candidates[0], alternatives:candidates.slice(1) };
    stack.push(frame);
    let current = linkedHierarchy.byId.get(frame.current.id);

    while (current) {
      if (current.type !== 'entity') {
        path = pathForNode(current.id, linkedHierarchy);
        options = current.children;
        break;
      }

      const link = byEntity.get(key(current.entityName));
      if (!link) break;
      const edge = await inspectEdge({
        question, dimensions, sourceEntity, targetEntity:current.entityName, joins:link.joins,
        globalContext, client, model, log, usage, step:++step
      });
      console.log(`[lemap query-v2][LINK ${step}] ${sourceEntity} → ${current.entityName} ${edge.decision.toUpperCase()} | ${fmtDims(edge.dimensions)} | score ${edge.confidence.toFixed(2)} | cumulative ${usage.total}`);
      if (edge.decision === 'follow') {
        return { choice:{ entity:current.entityName, joins:link.joins, dimensions:edge.dimensions, confidence:edge.confidence }, rejectedEntityKeys, step };
      }
      if (edge.decision === 'reject') rejectedEntityKeys.add(key(current.entityName));
      else deferred.push({ entity:current.entityName, joins:link.joins, dimensions:edge.dimensions, confidence:edge.confidence });

      let next = null;
      while (stack.length && !next) {
        const top = stack.at(-1);
        if (top.alternatives.length) {
          top.current = top.alternatives.shift();
          next = linkedHierarchy.byId.get(top.current.id);
        } else stack.pop();
      }
      if (!next) {
        const bestDeferred = deferred.sort((a, b) => b.confidence - a.confidence)[0] || null;
        return { choice:bestDeferred, rejectedEntityKeys, step };
      }
      current = next;
      if (current.type !== 'entity') {
        path = pathForNode(current.id, linkedHierarchy);
        options = current.children;
        break;
      }
    }
  }

  const bestDeferred = deferred.sort((a, b) => b.confidence - a.confidence)[0] || null;
  return { choice:bestDeferred, rejectedEntityKeys, step };
}
