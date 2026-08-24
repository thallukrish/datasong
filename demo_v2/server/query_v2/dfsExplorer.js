import { addUsage, arr, key, modelJson, text, uniq } from './modelJson.js';
import { compactOptions, compactPath } from './semanticHierarchy.js';
import { leafEvidence } from './graphContext.js';

const MAX_DFS_STEPS = 64;

const OPTION_SYSTEM = `You are navigating a hierarchical enterprise semantic graph with confidence-ordered DFS. The query has stable dimensions. For EVERY visible option, map any query dimensions it may help satisfy and assign confidence 0..1. Use decision="candidate" if it may matter at all, even weakly; use decision="reject" ONLY when the visible name+description is sufficient to conclude it does not help the query. Never reject merely because another option scores higher. Lower-confidence candidates are valuable alternate DFS paths. Keep reasons very short. Return {"assessments":[{"id":"exact visible id","decision":"candidate|reject","dimensions":[{"dimension":"exact supplied dimension","confidence":0.0}],"reason":"short"}]}.`;

const LEAF_SYSTEM = `You are at a leaf entity during confidence-ordered DFS over an enterprise semantic graph. Decide whether this entity contributes to the query dimensions using ONLY the supplied entity description, top semantic field descriptions, and evidenced links. decision="accept" means it contributes to the answer trail; "alternative" means plausible but weaker and should remain revisit-able; "reject" means evidence shows it does not help. Only explicit reject removes it. If accepted, select only supplied semantic fields that matter. You may follow ONE evidenced related hierarchy path if that linked entity is the best next place to investigate an uncovered dimension or connectivity. Never invent fields, paths or joins. Return {"decision":"accept|alternative|reject","dimensions":[{"dimension":"exact supplied dimension","confidence":0.0}],"fields":["supplied field names"],"followRelatedPathId":"exact supplied pathId or empty","reason":"short"}.`;

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
    const decision = item?.decision === 'reject' ? 'reject' : 'candidate';
    const normalized = {
      id,
      name:visible.get(id).name,
      decision,
      dimensions:normalizeDimensions(item?.dimensions, dimensions),
      reason:text(item?.reason, 160)
    };
    normalized.confidence = confidenceOf(normalized);
    byId.set(id, normalized);
  }

  return arr(options).map((option) => byId.get(String(option.id)) || {
    id:option.id,
    name:option.name,
    decision:'unassessed',
    dimensions:[],
    confidence:0,
    reason:'model omitted this visible option; retained as unassessed, never rejected by LeMap'
  });
}

function rankedCandidates(assessments) {
  return arr(assessments)
    .filter((item) => item.decision === 'candidate')
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

function assessmentSummary(item) {
  return {
    id:item.id,
    name:item.name,
    confidence:item.confidence,
    dimensions:item.dimensions
  };
}

function frameSummary(frame) {
  if (frame.kind === 'link') {
    return {
      kind:'link',
      fromEntity:frame.fromEntity,
      toEntity:frame.toEntity,
      toPath:frame.toPath,
      join:frame.join
    };
  }
  return {
    kind:'hierarchy',
    parentPath:frame.parentPath,
    current:frame.current ? assessmentSummary(frame.current) : null,
    alternatives:arr(frame.alternatives).map(assessmentSummary),
    deferred:arr(frame.deferred).map(assessmentSummary),
    rejected:arr(frame.rejected).map((item) => ({ id:item.id, name:item.name })),
    unassessed:arr(frame.unassessed).map((item) => ({ id:item.id, name:item.name }))
  };
}

function globalState({ dimensions, accepted, stack, rejected }) {
  return {
    dimensions,
    accepted:[...accepted.values()].map((item) => ({
      entity:item.entity,
      path:item.path,
      dimensions:item.dimensions,
      confidence:item.confidence,
      fields:item.fields
    })),
    stack:stack.map(frameSummary),
    rejected:[...rejected.values()].map((item) => ({ id:item.id, name:item.name, path:item.path }))
  };
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
  const call = await modelJson(client, model, OPTION_SYSTEM, payload, { maxTokens:1800 });
  addUsage(usage, call.usage);
  const assessments = normalizeAssessments(call.parsed, options, dimensions);
  log('query_v2_dfs_model', { step, phase:'score_options', assessments, usage:call.usage });
  return { assessments, usage:call.usage };
}

function makeHierarchyFrame(parentPath, assessments) {
  const candidates = rankedCandidates(assessments);
  const current = candidates[0] || null;
  return {
    kind:'hierarchy',
    parentPath:compactPath(parentPath),
    current,
    alternatives:candidates.slice(1),
    deferred:[],
    rejected:assessments.filter((item) => item.decision === 'reject'),
    unassessed:assessments.filter((item) => item.decision === 'unassessed')
  };
}

function markRejected(frame, rejected, hierarchy) {
  for (const item of arr(frame.rejected)) {
    const node = hierarchy.byId.get(item.id);
    rejected.set(item.id, {
      id:item.id,
      name:item.name,
      path:node ? pathForNode(node.id, hierarchy).map((part) => part.name) : [],
      reason:item.reason
    });
  }
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

function promoteAlternative(stack, hierarchy) {
  while (stack.length) {
    const top = stack.at(-1);
    if (top.kind === 'link') {
      stack.pop();
      continue;
    }
    if (top.alternatives.length) {
      const next = top.alternatives.shift();
      top.current = next;
      return hierarchy.byId.get(next.id) || null;
    }
    const deferred = top.deferred.find((item) => Number(item.revisits || 0) < 1);
    if (deferred) {
      deferred.revisits = Number(deferred.revisits || 0) + 1;
      top.current = deferred;
      return hierarchy.byId.get(deferred.id) || null;
    }
    stack.pop();
  }
  return null;
}

function coverage(accepted, dimensions) {
  const covered = new Set();
  for (const item of accepted.values()) {
    for (const dimension of arr(item.dimensions)) {
      if (Number(dimension.confidence || 0) > 0) covered.add(key(dimension.dimension));
    }
  }
  const missing = arr(dimensions).filter((dimension) => !covered.has(key(dimension)));
  return { covered:[...covered], missing };
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

function findRelatedPath(evidence, pathId) {
  for (const related of arr(evidence?.relatedEntities)) {
    for (const path of arr(related?.hierarchyPaths)) {
      if (path.pathId === pathId) return { related, path };
    }
  }
  return null;
}

function joinSignature(join) {
  return `${key(join?.from)}|${key(join?.to)}|${key(join?.relationship)}|${arr(join?.keyMaps).map((m) => `${key(m.fieldName)}:${key(m.relatedFieldName)}`).join(',')}`;
}

async function inspectLeaf({ question, dimensions, node, path, state, index, semanticHints, hierarchy, client, model, log, usage, step }) {
  const evidence = leafEvidence(node.entityName, index, semanticHints, hierarchy);
  const payload = {
    task:'semantic_dfs_inspect_leaf_entity',
    question,
    dimensions,
    currentPath:compactPath(path),
    leaf:evidence,
    globalContext:state
  };
  log('query_v2_dfs_payload', { step, phase:'leaf', payload });
  const call = await modelJson(client, model, LEAF_SYSTEM, payload, { maxTokens:1200 });
  addUsage(usage, call.usage);
  const decision = ['accept','alternative','reject'].includes(call.parsed?.decision) ? call.parsed.decision : 'alternative';
  const fieldNames = new Set(arr(evidence?.semanticFields).map((field) => key(field.field)));
  const normalizedDimensions = normalizeDimensions(call.parsed?.dimensions, dimensions);
  const result = {
    decision,
    dimensions:normalizedDimensions,
    confidence:confidenceOf({ dimensions:normalizedDimensions }),
    fields:uniq(arr(call.parsed?.fields).filter((field) => fieldNames.has(key(field)))),
    followRelatedPathId:String(call.parsed?.followRelatedPathId || ''),
    reason:text(call.parsed?.reason, 180),
    evidence
  };
  log('query_v2_dfs_model', { step, phase:'leaf', entity:node.entityName, result:{ ...result, evidence:undefined }, usage:call.usage });
  return result;
}

export async function deriveQueryDimensions({ question, client, model, log, usage }) {
  const system = 'Identify the stable business dimensions/measures/time/filter concepts that must be represented to answer the query. Keep this compact. Return {"intent":"short","dimensions":[{"name":"canonical concept","role":"measure|dimension|time|filter|attribute|derived"}]}. Do not choose clusters, entities or fields.';
  const call = await modelJson(client, model, system, { question }, { maxTokens:600 });
  addUsage(usage, call.usage);
  const dimensions = arr(call.parsed?.dimensions).slice(0, 12).map((item) => ({
    name:text(item?.name, 100),
    role:text(item?.role, 30)
  })).filter((item) => item.name);
  const logicalRequest = { intent:text(call.parsed?.intent, 180), dimensions };
  log('query_v2_dimensions', { question, logicalRequest, usage:call.usage });
  return logicalRequest;
}

export async function exploreSemanticDfs({ question, logicalRequest, hierarchy, index, semanticHints, client, model, log, usage }) {
  const dimensions = logicalRequest.dimensions.map((item) => item.name);
  const accepted = new Map();
  const rejected = new Map();
  const traversedJoins = new Map();
  const stack = [];
  const events = [];
  let step = 0;

  const rootState = globalState({ dimensions, accepted, stack, rejected });
  const rootCall = await assessOptions({
    question,
    dimensions,
    parentPath:[],
    options:hierarchy.clusters,
    state:rootState,
    client,
    model,
    log,
    usage,
    step:++step
  });
  const rootFrame = makeHierarchyFrame([], rootCall.assessments);
  markRejected(rootFrame, rejected, hierarchy);
  stack.push(rootFrame);
  let current = rootFrame.current ? hierarchy.byId.get(rootFrame.current.id) : null;

  while (current && step < MAX_DFS_STEPS) {
    const path = pathForNode(current.id, hierarchy);
    const state = globalState({ dimensions, accepted, stack, rejected });

    if (current.type !== 'entity') {
      const call = await assessOptions({
        question,
        dimensions,
        parentPath:path,
        options:current.children,
        state,
        client,
        model,
        log,
        usage,
        step:++step
      });
      const frame = makeHierarchyFrame(path, call.assessments);
      markRejected(frame, rejected, hierarchy);
      stack.push(frame);
      events.push({ step, action:'expand', path:path.map((part) => part.name), current:frame.current, alternatives:frame.alternatives, rejected:frame.rejected });
      current = frame.current ? hierarchy.byId.get(frame.current.id) : promoteAlternative(stack, hierarchy);
      continue;
    }

    const result = await inspectLeaf({
      question,
      dimensions,
      node:current,
      path,
      state,
      index,
      semanticHints,
      hierarchy,
      client,
      model,
      log,
      usage,
      step:++step
    });

    if (result.decision === 'reject') {
      rejected.set(current.id, { id:current.id, name:current.name, path:path.map((part) => part.name), reason:result.reason });
      events.push({ step, action:'reject_leaf', entity:current.name, reason:result.reason });
      current = promoteAlternative(stack, hierarchy);
      continue;
    }

    if (result.decision === 'alternative') {
      const parentFrame = [...stack].reverse().find((frame) => frame.kind === 'hierarchy');
      if (parentFrame && !parentFrame.deferred.some((item) => item.id === current.id)) {
        parentFrame.deferred.push({
          id:current.id,
          name:current.name,
          decision:'candidate',
          dimensions:result.dimensions,
          confidence:result.confidence,
          reason:result.reason,
          revisits:0
        });
        parentFrame.deferred.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
      }
      events.push({ step, action:'defer_leaf', entity:current.name, confidence:result.confidence });
      current = promoteAlternative(stack, hierarchy);
      continue;
    }

    accepted.set(key(current.entityName), {
      entity:current.entityName,
      path:path.map((part) => part.name),
      dimensions:result.dimensions,
      confidence:result.confidence,
      fields:result.fields,
      reason:result.reason
    });
    events.push({ step, action:'accept_leaf', entity:current.name, dimensions:result.dimensions, fields:result.fields });

    const relatedChoice = findRelatedPath(result.evidence, result.followRelatedPathId);
    if (relatedChoice) {
      const relatedNode = hierarchy.byId.get(relatedChoice.path.pathId);
      if (relatedNode) {
        const join = relatedChoice.related.join;
        traversedJoins.set(joinSignature(join), join);
        stack.push({
          kind:'link',
          fromEntity:current.entityName,
          toEntity:relatedChoice.related.entity,
          toPath:relatedChoice.path.path,
          join
        });
        events.push({ step, action:'follow_link', from:current.entityName, to:relatedChoice.related.entity, path:relatedChoice.path.path });
        current = relatedNode;
        continue;
      }
    }

    const status = coverage(accepted, dimensions);
    if (!status.missing.length && acceptedConnected(accepted, traversedJoins)) break;
    current = promoteAlternative(stack, hierarchy);
  }

  const status = coverage(accepted, dimensions);
  return {
    accepted:[...accepted.values()],
    rejected:[...rejected.values()],
    stack:stack.map(frameSummary),
    traversedJoins:[...traversedJoins.values()],
    coverage:status,
    connected:acceptedConnected(accepted, traversedJoins),
    complete:!status.missing.length && acceptedConnected(accepted, traversedJoins),
    steps:step,
    events
  };
}
