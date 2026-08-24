import { addUsage, arr, key, modelJson, text } from './modelJson.js';
import { compactOptions, compactPath } from './semanticHierarchy.js';
import { leafEvidence, linkedNeighbours } from './graphContext.js';
import { exploreLinkedEntities } from './linkedExplorer.js';

const MAX_DFS_STEPS = 64;

const OPTION_SYSTEM = `You are navigating a hierarchical enterprise semantic graph with confidence-ordered DFS. The query has stable dimensions. For EVERY visible option, map any query dimensions it may help satisfy and assign confidence 0..1. Use decision="candidate" if it may matter at all, even weakly; use decision="reject" ONLY when the visible name+description is sufficient to conclude it does not help the query. Never reject merely because another option scores higher. Lower-confidence candidates are alternate DFS paths. Return {"assessments":[{"id":"exact visible id","decision":"candidate|reject","dimensions":[{"dimension":"exact supplied dimension","confidence":0.0}]}]}.`;

const LEAF_SYSTEM = `You are at one entity leaf in a confidence-ordered DFS. Decide whether the entity contributes to the query using ONLY its short description and top five TF-IDF field-description hints. The hints are semantic evidence only; all fields of an accepted entity remain available to the final data view. Return {"decision":"accept|alternative|reject","dimensions":[{"dimension":"exact supplied dimension","confidence":0.0}],"reason":"short"}. accept means the entity contributes now; alternative means plausible but weaker and should remain revisit-able; reject means the evidence is enough to rule it out. Do not select fields and do not reason about joins here.`;

const fmtTokens = (usage) => `prompt ${Number(usage?.prompt || 0)} | output ${Number(usage?.completion || 0)} | call ${Number(usage?.total || 0)}`;
const fmtCumulative = (usage) => `cumulative ${Number(usage?.total || 0)}`;
const fmtDims = (dimensions) => arr(dimensions).map((item) => `${item.dimension}=${Number(item.confidence || 0).toFixed(2)}`).join(', ') || '-';
const fmtPath = (path) => arr(path).map((part) => part.name || part).filter(Boolean).join(' → ') || 'ROOT';

function confidenceOf(assessment) {
  return Math.max(0, ...arr(assessment?.dimensions).map((item) => Number(item?.confidence || 0)));
}

function normalizeDimensions(items, allowed) {
  const allowedByKey = new Map(arr(allowed).map((name) => [key(name), name]));
  return arr(items).map((item) => ({
    dimension:allowedByKey.get(key(item?.dimension)) || '',
    confidence:Math.max(0, Math.min(1, Number(item?.confidence || 0)))
  })).filter((item) => item.dimension);
}

function normalizeAssessments(parsed, options, dimensions) {
  const visible = new Map(arr(options).map((option) => [String(option.id), option]));
  const byId = new Map();
  for (const item of arr(parsed?.assessments)) {
    const id = String(item?.id || '');
    if (!visible.has(id) || byId.has(id)) continue;
    const normalized = {
      id,
      name:visible.get(id).name,
      decision:item?.decision === 'reject' ? 'reject' : 'candidate',
      dimensions:normalizeDimensions(item?.dimensions, dimensions)
    };
    normalized.confidence = confidenceOf(normalized);
    byId.set(id, normalized);
  }
  return arr(options).map((option) => byId.get(String(option.id)) || {
    id:option.id,
    name:option.name,
    decision:'unassessed',
    dimensions:[],
    confidence:0
  });
}

function rankedCandidates(assessments) {
  return arr(assessments)
    .filter((item) => item.decision === 'candidate')
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

function compactAssessment(item) {
  return item ? { id:item.id, name:item.name, score:item.confidence, dimensions:item.dimensions } : null;
}

function compactFrame(frame) {
  if (frame.kind === 'link') return { kind:'link', from:frame.fromEntity, to:frame.toEntity };
  return {
    kind:'hierarchy',
    current:compactAssessment(frame.current),
    alternatives:arr(frame.alternatives).map(compactAssessment),
    deferred:arr(frame.deferred).map(compactAssessment)
  };
}

function globalState({ dimensions, accepted, stack }) {
  return {
    dimensions,
    accepted:[...accepted.values()].map((item) => ({
      entity:item.entity,
      dimensions:item.dimensions,
      confidence:item.confidence
    })),
    stack:stack.map(compactFrame)
  };
}

function traceCall(step, phase, callUsage, cumulativeUsage) {
  console.log(`[lemap query-v2][DFS ${step}] ${phase} tokens: ${fmtTokens(callUsage)} | ${fmtCumulative(cumulativeUsage)}`);
}

function traceFrame(step, path, frame, usage) {
  console.log(`[lemap query-v2][DFS ${step}] PATH ${fmtPath(path)}`);
  if (frame.current) console.log(`  CURRENT: ${frame.current.name} | ${fmtDims(frame.current.dimensions)} | score ${Number(frame.current.confidence || 0).toFixed(2)}`);
  for (const item of arr(frame.alternatives)) console.log(`  ALT: ${item.name} | ${fmtDims(item.dimensions)} | score ${Number(item.confidence || 0).toFixed(2)}`);
  for (const item of arr(frame.rejected)) console.log(`  REJECT: ${item.name}`);
  console.log(`  ${fmtCumulative(usage)} | alternatives ${arr(frame.alternatives).length}`);
}

function pathForNode(nodeId, hierarchy) {
  const path = [];
  let currentId = nodeId;
  while (currentId) {
    const node = hierarchy.byId.get(currentId);
    if (!node) break;
    path.push({ id:node.id, type:node.type, name:node.name });
    currentId = hierarchy.parentById.get(currentId);
  }
  return path.reverse();
}

function descendantEntityKeys(node) {
  const result = new Set();
  const walk = (current) => {
    if (!current) return;
    if (current.type === 'entity') result.add(key(current.entityName));
    else for (const child of arr(current.children)) walk(child);
  };
  walk(node);
  return result;
}

async function assessOptions({ question, dimensions, parentPath, options, state, client, model, log, usage, step }) {
  const payload = {
    task:'semantic_dfs_score_visible_options',
    question,
    dimensions,
    currentPath:compactPath(parentPath),
    visibleOptions:compactOptions(options),
    globalContext:state
  };
  log('query_v2_dfs_payload', { step, phase:'score_options', payload });
  const call = await modelJson(client, model, OPTION_SYSTEM, payload, { maxTokens:1600 });
  addUsage(usage, call.usage);
  traceCall(step, 'SCORE', call.usage, usage);
  const assessments = normalizeAssessments(call.parsed, options, dimensions);
  log('query_v2_dfs_model', { step, phase:'score_options', assessments, usage:call.usage, cumulativeUsage:{ ...usage } });
  return assessments;
}

function makeHierarchyFrame(assessments) {
  const candidates = rankedCandidates(assessments);
  return {
    kind:'hierarchy',
    current:candidates[0] || null,
    alternatives:candidates.slice(1),
    deferred:[],
    rejected:assessments.filter((item) => item.decision === 'reject')
  };
}

function recordRejected(frame, rejected, rejectedEntityKeys, hierarchy) {
  for (const item of arr(frame.rejected)) {
    rejected.set(item.id, { id:item.id, name:item.name });
    const node = hierarchy.byId.get(item.id);
    for (const entityKey of descendantEntityKeys(node)) rejectedEntityKeys.add(entityKey);
  }
}

function promoteAlternative(stack, hierarchy, usage) {
  while (stack.length) {
    const top = stack.at(-1);
    if (top.kind === 'link') {
      console.log(`[lemap query-v2][DFS POP] link ${top.fromEntity} → ${top.toEntity} | ${fmtCumulative(usage)}`);
      stack.pop();
      continue;
    }
    if (top.alternatives.length) {
      const next = top.alternatives.shift();
      top.current = next;
      console.log(`[lemap query-v2][DFS RESUME] ${next.name} | score ${Number(next.confidence || 0).toFixed(2)} | ${fmtCumulative(usage)}`);
      return hierarchy.byId.get(next.id) || null;
    }
    const deferred = top.deferred.find((item) => Number(item.revisits || 0) < 1);
    if (deferred) {
      deferred.revisits = Number(deferred.revisits || 0) + 1;
      top.current = deferred;
      console.log(`[lemap query-v2][DFS RESUME] deferred ${deferred.name} | score ${Number(deferred.confidence || 0).toFixed(2)} | ${fmtCumulative(usage)}`);
      return hierarchy.byId.get(deferred.id) || null;
    }
    stack.pop();
  }
  return null;
}

function coverage(accepted, dimensions) {
  const covered = new Set();
  for (const item of accepted.values()) {
    for (const dimension of arr(item.dimensions)) if (Number(dimension.confidence || 0) > 0) covered.add(key(dimension.dimension));
  }
  return {
    covered:[...covered],
    missing:arr(dimensions).filter((dimension) => !covered.has(key(dimension)))
  };
}

function acceptedConnected(accepted, traversedJoins) {
  const names = [...accepted.values()].map((item) => item.entity);
  if (names.length <= 1) return true;
  const wanted = new Set(names.map(key));
  const adjacency = new Map();
  for (const join of traversedJoins.values()) {
    const a = key(join.from), b = key(join.to);
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }
  const seen = new Set();
  const queue = [key(names[0])];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) || []) if (!seen.has(next)) queue.push(next);
  }
  return [...wanted].every((name) => seen.has(name));
}

function joinSignature(join) {
  return `${key(join?.from)}|${key(join?.to)}|${key(join?.relationship)}|${arr(join?.keyMaps).map((m) => `${key(m.fieldName)}:${key(m.relatedFieldName)}`).join(',')}`;
}

async function inspectLeaf({ question, dimensions, node, path, state, index, semanticHints, client, model, log, usage, step }) {
  const evidence = leafEvidence(node.entityName, index, semanticHints);
  const payload = {
    task:'semantic_dfs_inspect_leaf_entity',
    question,
    dimensions,
    currentPath:compactPath(path),
    leaf:evidence,
    globalContext:state
  };
  log('query_v2_dfs_payload', { step, phase:'leaf', payload });
  const call = await modelJson(client, model, LEAF_SYSTEM, payload, { maxTokens:600 });
  addUsage(usage, call.usage);
  traceCall(step, 'LEAF', call.usage, usage);
  const normalizedDimensions = normalizeDimensions(call.parsed?.dimensions, dimensions);
  const result = {
    decision:['accept','alternative','reject'].includes(call.parsed?.decision) ? call.parsed.decision : 'alternative',
    dimensions:normalizedDimensions,
    confidence:confidenceOf({ dimensions:normalizedDimensions }),
    reason:text(call.parsed?.reason, 100)
  };
  log('query_v2_dfs_model', { step, phase:'leaf', entity:node.entityName, result, usage:call.usage, cumulativeUsage:{ ...usage } });
  return result;
}

export async function deriveQueryDimensions({ question, client, model, log, usage }) {
  const system = 'Identify the stable business dimensions/measures/time/filter concepts that must be represented to answer the query. Keep this compact. Return {"intent":"short","dimensions":[{"name":"canonical concept","role":"measure|dimension|time|filter|attribute|derived"}]}. Do not choose clusters, entities or fields.';
  const call = await modelJson(client, model, system, { question }, { maxTokens:600 });
  addUsage(usage, call.usage);
  console.log(`[lemap query-v2][DIMENSIONS] tokens: ${fmtTokens(call.usage)} | ${fmtCumulative(usage)}`);
  const dimensions = arr(call.parsed?.dimensions).slice(0, 12).map((item) => ({ name:text(item?.name, 100), role:text(item?.role, 30) })).filter((item) => item.name);
  const logicalRequest = { intent:text(call.parsed?.intent, 180), dimensions };
  log('query_v2_dimensions', { question, logicalRequest, usage:call.usage, cumulativeUsage:{ ...usage } });
  return logicalRequest;
}

export async function exploreSemanticDfs({ question, logicalRequest, hierarchy, index, semanticHints, client, model, log, usage }) {
  const dimensions = logicalRequest.dimensions.map((item) => item.name);
  const accepted = new Map();
  const rejected = new Map();
  const rejectedEntityKeys = new Set();
  const exploredEntityKeys = new Set();
  const traversedJoins = new Map();
  const stack = [];
  const events = [];
  let step = 0;

  let assessments = await assessOptions({
    question, dimensions, parentPath:[], options:hierarchy.clusters,
    state:globalState({ dimensions, accepted, stack }), client, model, log, usage, step:++step
  });
  let frame = makeHierarchyFrame(assessments);
  recordRejected(frame, rejected, rejectedEntityKeys, hierarchy);
  stack.push(frame);
  traceFrame(step, [], frame, usage);
  let current = frame.current ? hierarchy.byId.get(frame.current.id) : null;

  while (current && step < MAX_DFS_STEPS) {
    const path = pathForNode(current.id, hierarchy);
    const state = globalState({ dimensions, accepted, stack });

    if (current.type !== 'entity') {
      assessments = await assessOptions({
        question, dimensions, parentPath:path, options:current.children,
        state, client, model, log, usage, step:++step
      });
      frame = makeHierarchyFrame(assessments);
      recordRejected(frame, rejected, rejectedEntityKeys, hierarchy);
      stack.push(frame);
      traceFrame(step, path, frame, usage);
      events.push({ step, action:'expand', path:path.map((part) => part.name), current:frame.current, alternatives:frame.alternatives });
      current = frame.current ? hierarchy.byId.get(frame.current.id) : promoteAlternative(stack, hierarchy, usage);
      continue;
    }

    exploredEntityKeys.add(key(current.entityName));
    const result = await inspectLeaf({
      question, dimensions, node:current, path, state,
      index, semanticHints, client, model, log, usage, step:++step
    });
    console.log(`[lemap query-v2][DFS ${step}] LEAF ${fmtPath(path)} → ${result.decision.toUpperCase()} | ${fmtDims(result.dimensions)} | score ${result.confidence.toFixed(2)} | ${fmtCumulative(usage)}`);

    if (result.decision === 'reject') {
      rejected.set(current.id, { id:current.id, name:current.name });
      rejectedEntityKeys.add(key(current.entityName));
      events.push({ step, action:'reject_leaf', entity:current.name });
      current = promoteAlternative(stack, hierarchy, usage);
      continue;
    }

    if (result.decision === 'alternative') {
      const parentFrame = [...stack].reverse().find((item) => item.kind === 'hierarchy');
      if (parentFrame && !parentFrame.deferred.some((item) => item.id === current.id)) {
        parentFrame.deferred.push({ id:current.id, name:current.name, dimensions:result.dimensions, confidence:result.confidence, revisits:0 });
        parentFrame.deferred.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
      }
      events.push({ step, action:'defer_leaf', entity:current.name, confidence:result.confidence });
      current = promoteAlternative(stack, hierarchy, usage);
      continue;
    }

    accepted.set(key(current.entityName), {
      entity:current.entityName,
      path:path.map((part) => part.name),
      dimensions:result.dimensions,
      confidence:result.confidence,
      reason:result.reason
    });
    console.log(`[lemap query-v2][DFS ACCEPT] ${current.entityName} | accepted ${accepted.size} | ${fmtCumulative(usage)}`);
    events.push({ step, action:'accept_leaf', entity:current.name, dimensions:result.dimensions });

    const blocked = new Set([...exploredEntityKeys, ...rejectedEntityKeys, ...accepted.keys()]);
    blocked.delete(key(current.entityName));
    const linked = linkedNeighbours(current.entityName, index, { blockedEntityKeys:blocked });

    for (const connection of linked.connections) {
      if (!accepted.has(key(connection.entity))) continue;
      traversedJoins.set(joinSignature(connection.join), connection.join);
      events.push({ step, action:'connect_existing', from:current.entityName, to:connection.entity });
    }

    if (linked.eligible.length) {
      console.log(`[lemap query-v2][LINK] ${current.entityName}: ${linked.eligible.length} new eligible neighbours; exploring through filtered hierarchy`);
      const linkedResult = await exploreLinkedEntities({
        question,
        dimensions,
        sourceEntity:current.entityName,
        eligibleLinks:linked.eligible,
        hierarchy,
        globalContext:globalState({ dimensions, accepted, stack }),
        client,
        model,
        log,
        usage,
        startStep:step
      });
      step = linkedResult.step;
      for (const entityKey of linkedResult.rejectedEntityKeys) rejectedEntityKeys.add(entityKey);
      if (linkedResult.choice && !exploredEntityKeys.has(key(linkedResult.choice.entity)) && !rejectedEntityKeys.has(key(linkedResult.choice.entity))) {
        const targetPaths = arr(hierarchy.pathsByEntity.get(key(linkedResult.choice.entity)));
        const targetPath = targetPaths[0];
        const targetNode = targetPath ? hierarchy.byId.get(targetPath.pathId) : null;
        if (targetNode) {
          for (const join of arr(linkedResult.choice.joins)) traversedJoins.set(joinSignature(join), join);
          stack.push({ kind:'link', fromEntity:current.entityName, toEntity:linkedResult.choice.entity });
          console.log(`[lemap query-v2][DFS PUSH] ${current.entityName} → ${linkedResult.choice.entity} | stack depth ${stack.length} | ${fmtCumulative(usage)}`);
          events.push({ step, action:'follow_link', from:current.entityName, to:linkedResult.choice.entity });
          current = targetNode;
          continue;
        }
      }
    }

    const currentCoverage = coverage(accepted, dimensions);
    const connected = acceptedConnected(accepted, traversedJoins);
    if (!currentCoverage.missing.length && connected) {
      console.log(`[lemap query-v2][DFS DONE] all dimensions covered and accepted trail connected | ${fmtCumulative(usage)}`);
      break;
    }
    current = promoteAlternative(stack, hierarchy, usage);
  }

  const finalCoverage = coverage(accepted, dimensions);
  const connected = acceptedConnected(accepted, traversedJoins);
  return {
    accepted:[...accepted.values()],
    rejected:[...rejected.values()],
    traversedJoins:[...traversedJoins.values()],
    stack:stack.map(compactFrame),
    coverage:finalCoverage,
    connected,
    complete:!finalCoverage.missing.length && connected,
    steps:step,
    events
  };
}
