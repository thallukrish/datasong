import { acceptedGraph, buildGraphIndex, buildSemanticFieldHints } from '../query_v2/graphContext.js';
import { buildSemanticHierarchy } from '../query_v2/semanticHierarchy.js';
import { addUsage, arr, key, modelJson } from '../query_v2/modelJson.js';
import { Frontier } from '../query_v3/frontier.js';
import { activeScore } from '../query_v3/pathScore.js';
import { connectEvidenceEntities } from './connectivity.js';
import { deriveDimensions, scoreNextStates } from './scorer.js';
import { coverageState, evaluateEntityCoverage } from './coverage.js';
import { expandState, rootStates } from './stateExpander.js';

const MAX_STEPS = 64;
const FINAL_SYSTEM = `Answer using ONLY the evidence-backed entities and evidenced joins supplied. Every selected entity contributes all fields, represented with field="*". Join fields may appear only from supplied keyMaps. If exploration is incomplete, say so and name missing dimensions or missing connectivity. Return {"answer":"concise","dataView":{"grain":"","select":[{"entity":"","field":"*","role":"dimension|measure|time|filter|attribute|derived"}],"joins":[{"left":"Entity.joinField","right":"Entity.joinField","relation":"","evidenced":true}],"missing":[]},"nextStep":"optional"}.`;

function joinSignature(join) {
  return `${key(join?.from)}|${key(join?.to)}|${key(join?.relationship)}|${arr(join?.keyMaps).map((m) => `${key(m.fieldName)}:${key(m.relatedFieldName)}`).join(',')}`;
}

function acceptedConnected(accepted, joins) {
  const names = [...accepted.values()].filter((item) => arr(item.covered).length).map((item) => item.entity);
  if (names.length <= 1) return true;
  const wanted = new Set(names.map(key));
  const adjacency = new Map();
  for (const join of joins.values()) {
    const a = key(join.from), b = key(join.to);
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b); adjacency.get(b).add(a);
  }
  const seen = new Set(), queue = [key(names[0])];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) || []) if (!seen.has(next)) queue.push(next);
  }
  return [...wanted].every((name) => seen.has(name));
}

function selectedEntityKeys(path) {
  return new Set(path.states.filter((state) => state.type === 'entity' && state.entityName).map((state) => key(state.entityName)));
}

function nextPath(parent, item) {
  const join = item.state.edge?.kind === 'schema_fk' ? item.state.edge.join : null;
  return {
    states:[...(parent.states || []), item.state],
    score:item.score,
    joins:join ? [...(parent.joins || []), join] : [...(parent.joins || [])]
  };
}

function compactPath(path, missing) {
  return {
    states:path.states.map((state) => state.name),
    score:path.score,
    priority:activeScore(path.score, missing),
    joins:path.joins || []
  };
}

async function activateDormant({ frontier, logicalRequest, dimensions, missingDimensions, client, model, usage, log, stepRef }) {
  const group = frontier.takeDormantGroup(8);
  if (!group.length) return;
  const parent = group[0].parentPath || { states:[], score:{}, joins:[] };
  const candidates = group.map((item) => item.states.at(-1));
  const result = await scoreNextStates({
    intent:logicalRequest.intent,
    dimensions,
    missingDimensions,
    path:parent,
    candidates,
    client, model, usage, log, step:++stepRef.value
  });
  frontier.add(result.scored.map((item) => nextPath(parent, item)));
}

function runConnectivity({ accepted, index, traversedJoins, connectorEntities, events, log, step }) {
  const evidenceEntities = [...accepted.values()]
    .filter((item) => arr(item.covered).length)
    .map((item) => item.entity);
  const result = connectEvidenceEntities(index, evidenceEntities);
  for (const join of arr(result.joins)) traversedJoins.set(joinSignature(join), join);
  for (const entity of arr(result.entities)) connectorEntities.add(key(entity));
  const event = {
    step,
    action:'lemap_connectivity',
    evidenceEntities,
    connected:result.connected,
    connectorEntities:result.entities,
    paths:result.paths,
    joins:result.joins,
    unconnected:result.unconnected || []
  };
  events.push(event);
  log('query_v4_connectivity', event);
  console.log(`[lemap query-v4][${step}] connectivity ${result.connected ? 'complete' : 'incomplete'} | evidence ${evidenceEntities.join(', ')} | connector entities ${result.entities.length} | joins ${result.joins.length}`);
  return result;
}

export async function runSemanticBestFirstQueryV4({ question, client, model, graph, directory, workflows = [], log = () => {} }) {
  const usage = { prompt:0, completion:0, total:0 };
  const index = buildGraphIndex(graph);
  const semanticHints = buildSemanticFieldHints(index.entities);
  const hierarchy = buildSemanticHierarchy(directory, index.entities);
  const logicalRequest = await deriveDimensions({ question, client, model, usage, log });
  const dimensions = logicalRequest.dimensions.map((item) => item.name);
  const accepted = new Map();
  const traversedJoins = new Map();
  const connectorEntities = new Set();
  const frontier = new Frontier();
  const events = [];
  const stepRef = { value:0 };
  let connectivity = null;

  const roots = rootStates(hierarchy, workflows);
  const workflowRootCount = roots.filter((state) => state.type === 'workflow').length;
  const directoryRootCount = roots.length - workflowRootCount;
  log('query_v4_seed_roots', {
    workflowRootCount,
    directoryRootCount,
    workflowRoots:roots.filter((state) => state.type === 'workflow').map((state) => ({ name:state.name, entityCount:state.workflowEntities.length })),
    directoryRoots:roots.filter((state) => state.type !== 'workflow').map((state) => state.name)
  });

  const rootParent = { states:[], score:{}, joins:[] };
  const initial = await scoreNextStates({
    intent:logicalRequest.intent,
    dimensions,
    missingDimensions:dimensions,
    path:rootParent,
    candidates:roots,
    client, model, usage, log, step:++stepRef.value
  });
  frontier.add(initial.scored.map((item) => nextPath(rootParent, item)));
  frontier.addDormant(rootParent, initial.omitted);

  while ((frontier.size || frontier.dormantSize) && stepRef.value < MAX_STEPS) {
    let coverage = coverageState(dimensions, accepted);
    if (!coverage.missing.length) {
      connectivity = runConnectivity({ accepted, index, traversedJoins, connectorEntities, events, log, step:++stepRef.value });
      break;
    }

    if (!frontier.size && frontier.dormantSize) {
      await activateDormant({ frontier, logicalRequest, dimensions, missingDimensions:coverage.missing, client, model, usage, log, stepRef });
      if (!frontier.size) continue;
    }

    const path = frontier.popBest(coverage.missing);
    if (!path) continue;
    const current = path.states.at(-1);
    events.push({ step:stepRef.value, action:'select_path', seedSource:path.states[0]?.type === 'workflow' ? 'workflow' : 'directory', ...compactPath(path, coverage.missing), frontierSize:frontier.size, dormantSize:frontier.dormantSize });
    console.log(`[lemap query-v4][${stepRef.value}] ${path.states.map((state) => state.name).join(' → ')} | priority ${activeScore(path.score, coverage.missing).toFixed(2)} | missing ${coverage.missing.join(', ') || '-'} | frontier ${frontier.size}+${frontier.dormantSize}`);

    for (const join of arr(path.joins)) traversedJoins.set(joinSignature(join), join);

    if (current.type === 'entity' && current.entityName) {
      const covered = await evaluateEntityCoverage({ state:current, dimensions, missingDimensions:coverage.missing, client, model, usage, log, step:++stepRef.value });
      const entityKey = key(current.entityName);
      const existing = accepted.get(entityKey) || { entity:current.entityName, covered:[], paths:[] };
      const byDimension = new Map(arr(existing.covered).map((item) => [item.dimension, item]));
      for (const item of covered) if (!byDimension.has(item.dimension)) byDimension.set(item.dimension, item);
      existing.covered = [...byDimension.values()];
      if (!existing.paths.some((p) => p.join('>') === path.states.map((state) => state.name).join('>'))) existing.paths.push(path.states.map((state) => state.name));
      accepted.set(entityKey, existing);
      if (covered.length) events.push({ step:stepRef.value, action:'coverage', entity:current.entityName, covered });
      coverage = coverageState(dimensions, accepted);
      if (!coverage.missing.length) {
        connectivity = runConnectivity({ accepted, index, traversedJoins, connectorEntities, events, log, step:++stepRef.value });
        break;
      }
    }

    const candidates = expandState(current, {
      hierarchy,
      index,
      semanticHints,
      visitedEntityKeys:selectedEntityKeys(path)
    });
    if (!candidates.length) continue;

    const scored = await scoreNextStates({
      intent:logicalRequest.intent,
      dimensions,
      missingDimensions:coverage.missing,
      path,
      candidates,
      client,
      model,
      usage,
      log,
      step:++stepRef.value
    });
    const nextPaths = scored.scored.map((item) => nextPath(path, item));
    frontier.add(nextPaths);
    frontier.addDormant(path, scored.omitted);
    events.push({
      step:stepRef.value,
      action:'expand',
      from:current.name,
      candidates:nextPaths.map((item) => compactPath(item, coverage.missing)),
      omitted:scored.omitted.map((state) => state.name),
      frontierSize:frontier.size,
      dormantSize:frontier.dormantSize
    });
  }

  const coverage = coverageState(dimensions, accepted);
  if (!coverage.missing.length && !connectivity) {
    connectivity = runConnectivity({ accepted, index, traversedJoins, connectorEntities, events, log, step:++stepRef.value });
  }
  const connected = !coverage.missing.length
    ? !!connectivity?.connected
    : acceptedConnected(accepted, traversedJoins);
  const complete = !coverage.missing.length && connected;

  const groundedAccepted = new Map([...accepted].map(([k, item]) => [k, { entity:item.entity }]));
  for (const entityKey of connectorEntities) {
    if (groundedAccepted.has(entityKey)) continue;
    const entity = index.entities.get(entityKey);
    if (entity) groundedAccepted.set(entityKey, { entity:entity.name });
  }
  const grounded = acceptedGraph(groundedAccepted, traversedJoins, index);

  log('query_v4_search_complete', {
    complete,
    connected,
    coverage,
    accepted:[...accepted.values()],
    connectivity,
    joins:[...traversedJoins.values()],
    frontier:frontier.snapshot(coverage.missing),
    events,
    cumulativeUsage:{...usage}
  });

  const finalPayload = {
    question,
    logicalRequest,
    status:{ complete, connected, missingDimensions:coverage.missing, steps:stepRef.value },
    acceptedEntities:[...accepted.values()].filter((item) => item.covered.length),
    connectivity,
    evidencedGraph:grounded
  };
  const finalCall = await modelJson(client, model, FINAL_SYSTEM, finalPayload, { maxTokens:900 });
  addUsage(usage, finalCall.usage);
  log('query_v4_answer', { response:finalCall.parsed, usage:finalCall.usage, cumulativeUsage:{...usage} });

  return {
    ...finalCall.parsed,
    investigation:{
      mode:'semantic-best-first-parallel-workflow-directory-v4',
      logicalRequest,
      complete,
      connected,
      steps:stepRef.value,
      coverage,
      accepted:[...accepted.values()],
      connectivity,
      frontier:frontier.snapshot(coverage.missing),
      localGraph:{ entities:grounded.entities.map((entity) => entity.name), joins:grounded.joins },
      events,
      usage
    }
  };
}
