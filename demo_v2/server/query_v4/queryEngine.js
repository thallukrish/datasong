import { acceptedGraph, buildGraphIndex, buildSemanticFieldHints } from '../query_v2/graphContext.js';
import { buildSemanticHierarchy } from '../query_v2/semanticHierarchy.js';
import { addUsage, arr, key, modelJson } from '../query_v2/modelJson.js';
import { Frontier } from '../query_v3/frontier.js';
import { activeScore } from '../query_v3/pathScore.js';
import { connectEvidenceEntities } from './connectivity.js';
import { deriveDimensions, scoreNextStates } from './scorer.js';
import { coverageState, evaluateEntityCoverage } from './coverage.js';
import { expandLinkedEntities, expandState, rootStates } from './stateExpander.js';
import { verifyAnswerability } from './verifier.js';

const MAX_STEPS = 64;
const REPAIR_MAX_SELECTIONS = 10;
const FINAL_SYSTEM = `Answer using ONLY the evidence-backed entities and evidenced joins supplied. Every selected entity contributes all fields, represented with field="*". Join fields may appear only from supplied keyMaps. The answerability verification is authoritative: if verification.answerable is false, do NOT claim the requested result is computable; concisely explain the unresolved requirement instead. If exploration is incomplete, say so and name missing dimensions or missing connectivity. Return {"answer":"concise","dataView":{"grain":"","select":[{"entity":"","field":"*","role":"dimension|measure|time|filter|attribute|derived"}],"joins":[{"left":"Entity.joinField","right":"Entity.joinField","relation":"","evidenced":true}],"missing":[]},"nextStep":"optional"}.`;

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

function runConnectivity({ accepted, index, traversedJoins, connectorEntities, events, log, step, phase = 'initial' }) {
  const evidenceEntities = [...accepted.values()]
    .filter((item) => arr(item.covered).length)
    .map((item) => item.entity);
  const result = connectEvidenceEntities(index, evidenceEntities);
  for (const join of arr(result.joins)) traversedJoins.set(joinSignature(join), join);
  for (const entity of arr(result.entities)) connectorEntities.add(key(entity));
  const event = {
    step,
    phase,
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
  console.log(`[lemap query-v4][${step}] ${phase} connectivity ${result.connected ? 'complete' : 'incomplete'} | evidence ${evidenceEntities.join(', ')} | connector entities ${result.entities.length} | joins ${result.joins.length}`);
  return result;
}

function groundedGraph({ accepted, connectorEntities, traversedJoins, index }) {
  const groundedAccepted = new Map([...accepted].map(([k, item]) => [k, { entity:item.entity }]));
  for (const entityKey of connectorEntities) {
    if (groundedAccepted.has(entityKey)) continue;
    const entity = index.entities.get(entityKey);
    if (entity) groundedAccepted.set(entityKey, { entity:entity.name });
  }
  return acceptedGraph(groundedAccepted, traversedJoins, index);
}

function repairAnchorState(entityName) {
  return {
    id:`repair-anchor:${key(entityName)}`,
    name:entityName,
    type:'entity',
    entityName,
    edge:{ kind:'repair_anchor' }
  };
}

function reopenCoverage(accepted, reopenDimensions) {
  const reopenKeys = new Set(reopenDimensions.map(key));
  const priorProviders = [];
  const locked = [];
  for (const item of accepted.values()) {
    const kept = [];
    for (const coverage of arr(item.covered)) {
      if (reopenKeys.has(key(coverage.dimension))) priorProviders.push(item.entity);
      else {
        kept.push(coverage);
        locked.push({ entity:item.entity, dimension:coverage.dimension, field:coverage.field });
      }
    }
    item.covered = kept;
  }
  return { priorProviders:[...new Set(priorProviders)], locked };
}

async function runFocusedRepair({
  verification,
  logicalRequest,
  dimensions,
  accepted,
  hierarchy,
  index,
  semanticHints,
  traversedJoins,
  client,
  model,
  usage,
  log,
  events,
  stepRef
}) {
  const reopen = arr(verification?.reopen).filter(Boolean);
  if (!reopen.length) return { attempted:false, repaired:false, reopen:[], anchors:[], locked:[] };

  const { priorProviders, locked } = reopenCoverage(accepted, reopen);
  const suppliedAnchors = arr(verification?.anchors).filter((name) => index.entities.has(key(name)));
  const anchors = [...new Set(suppliedAnchors.length ? suppliedAnchors : priorProviders)].filter((name) => index.entities.has(key(name)));
  const repairFrontier = new Frontier();
  const repairEvent = {
    step:++stepRef.value,
    action:'repair_start',
    requirement:verification.requirement || '',
    reopen,
    anchors,
    locked
  };
  events.push(repairEvent);
  log('query_v4_repair_start', repairEvent);

  for (const anchor of anchors) {
    const parent = { states:[repairAnchorState(anchor)], score:{}, joins:[] };
    const candidates = expandLinkedEntities(parent.states[0], {
      hierarchy,
      index,
      semanticHints,
      visitedEntityKeys:new Set([key(anchor)])
    });
    if (!candidates.length) continue;
    const scored = await scoreNextStates({
      intent:`Repair only: ${verification.requirement || reopen.join(', ')}. Preserve locked evidence.`,
      dimensions,
      missingDimensions:coverageState(dimensions, accepted).missing,
      path:parent,
      candidates,
      client, model, usage, log, step:++stepRef.value
    });
    repairFrontier.add(scored.scored.map((item) => nextPath(parent, item)));
    repairFrontier.addDormant(parent, scored.omitted);
  }

  let selections = 0;
  while ((repairFrontier.size || repairFrontier.dormantSize) && selections < REPAIR_MAX_SELECTIONS) {
    let coverage = coverageState(dimensions, accepted);
    if (!coverage.missing.length) break;

    if (!repairFrontier.size && repairFrontier.dormantSize) {
      await activateDormant({
        frontier:repairFrontier,
        logicalRequest:{ intent:`Repair only: ${verification.requirement || reopen.join(', ')}. Preserve locked evidence.` },
        dimensions,
        missingDimensions:coverage.missing,
        client, model, usage, log, stepRef
      });
      if (!repairFrontier.size) continue;
    }

    const path = repairFrontier.popBest(coverage.missing);
    if (!path) continue;
    selections += 1;
    const current = path.states.at(-1);
    for (const join of arr(path.joins)) traversedJoins.set(joinSignature(join), join);
    const selectedEvent = {
      step:stepRef.value,
      action:'repair_select',
      requirement:verification.requirement || '',
      locked,
      ...compactPath(path, coverage.missing),
      frontierSize:repairFrontier.size,
      dormantSize:repairFrontier.dormantSize
    };
    events.push(selectedEvent);
    log('query_v4_repair_select', selectedEvent);

    if (current.type === 'entity' && current.entityName) {
      const covered = await evaluateEntityCoverage({
        state:current,
        dimensions,
        missingDimensions:coverage.missing,
        client, model, usage, log, step:++stepRef.value
      });
      const allowed = new Set(reopen.map(key));
      const repairCovered = covered.filter((item) => allowed.has(key(item.dimension)));
      const entityKey = key(current.entityName);
      const existing = accepted.get(entityKey) || { entity:current.entityName, covered:[], paths:[] };
      const byDimension = new Map(arr(existing.covered).map((item) => [key(item.dimension), item]));
      for (const item of repairCovered) if (!byDimension.has(key(item.dimension))) byDimension.set(key(item.dimension), item);
      existing.covered = [...byDimension.values()];
      if (!existing.paths.some((p) => p.join('>') === path.states.map((state) => state.name).join('>'))) existing.paths.push(path.states.map((state) => state.name));
      accepted.set(entityKey, existing);
      if (repairCovered.length) {
        const coverageEvent = { step:stepRef.value, action:'repair_coverage', entity:current.entityName, covered:repairCovered, locked };
        events.push(coverageEvent);
        log('query_v4_repair_coverage', coverageEvent);
      }
      coverage = coverageState(dimensions, accepted);
      if (!coverage.missing.length) break;
    }

    const candidates = expandLinkedEntities(current, {
      hierarchy,
      index,
      semanticHints,
      visitedEntityKeys:selectedEntityKeys(path)
    });
    if (!candidates.length) continue;
    const scored = await scoreNextStates({
      intent:`Repair only: ${verification.requirement || reopen.join(', ')}. Preserve locked evidence.`,
      dimensions,
      missingDimensions:coverageState(dimensions, accepted).missing,
      path,
      candidates,
      client, model, usage, log, step:++stepRef.value
    });
    repairFrontier.add(scored.scored.map((item) => nextPath(path, item)));
    repairFrontier.addDormant(path, scored.omitted);
  }

  const finalCoverage = coverageState(dimensions, accepted);
  const result = {
    attempted:true,
    repaired:reopen.every((dimension) => !finalCoverage.missing.some((missing) => key(missing) === key(dimension))),
    reopen,
    anchors,
    locked,
    selections,
    remaining:finalCoverage.missing
  };
  log('query_v4_repair_complete', { ...result, cumulativeUsage:{...usage} });
  events.push({ step:stepRef.value, action:'repair_complete', ...result });
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
  let verification = null;
  let repair = { attempted:false, repaired:false, reopen:[], anchors:[], locked:[] };

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
      const byDimension = new Map(arr(existing.covered).map((item) => [key(item.dimension), item]));
      for (const item of covered) if (!byDimension.has(key(item.dimension))) byDimension.set(key(item.dimension), item);
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

  let coverage = coverageState(dimensions, accepted);
  if (!coverage.missing.length && !connectivity) {
    connectivity = runConnectivity({ accepted, index, traversedJoins, connectorEntities, events, log, step:++stepRef.value });
  }

  let connected = !coverage.missing.length
    ? !!connectivity?.connected
    : acceptedConnected(accepted, traversedJoins);
  let complete = !coverage.missing.length && connected;
  let grounded = groundedGraph({ accepted, connectorEntities, traversedJoins, index });

  if (complete) {
    verification = await verifyAnswerability({
      question,
      logicalRequest,
      accepted,
      connectivity,
      evidencedGraph:grounded,
      client, model, usage, log,
      pass:1
    });

    if (!verification.answerable && verification.reopen.length) {
      repair = await runFocusedRepair({
        verification,
        logicalRequest,
        dimensions,
        accepted,
        hierarchy,
        index,
        semanticHints,
        traversedJoins,
        client,
        model,
        usage,
        log,
        events,
        stepRef
      });

      coverage = coverageState(dimensions, accepted);
      connectorEntities.clear();
      connectivity = !coverage.missing.length
        ? runConnectivity({ accepted, index, traversedJoins, connectorEntities, events, log, step:++stepRef.value, phase:'repair' })
        : null;
      connected = !coverage.missing.length ? !!connectivity?.connected : acceptedConnected(accepted, traversedJoins);
      complete = !coverage.missing.length && connected;
      grounded = groundedGraph({ accepted, connectorEntities, traversedJoins, index });

      if (complete) {
        verification = await verifyAnswerability({
          question,
          logicalRequest,
          accepted,
          connectivity,
          evidencedGraph:grounded,
          client, model, usage, log,
          pass:2
        });
      } else {
        verification = {
          answerable:false,
          reopen:repair.reopen,
          anchors:repair.anchors,
          requirement:verification.requirement,
          reason:'Focused repair did not resolve and connect all reopened evidence.'
        };
      }
    }
  } else {
    verification = {
      answerable:false,
      reopen:coverage.missing,
      anchors:[],
      requirement:'complete evidence and connectivity',
      reason:'Initial exploration did not produce complete connected evidence.'
    };
  }

  log('query_v4_search_complete', {
    complete,
    connected,
    coverage,
    verification,
    repair,
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
    status:{ complete, connected, answerable:verification?.answerable === true, missingDimensions:coverage.missing, steps:stepRef.value },
    verification,
    repair,
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
      answerable:verification?.answerable === true,
      steps:stepRef.value,
      coverage,
      verification,
      repair,
      accepted:[...accepted.values()],
      connectivity,
      frontier:frontier.snapshot(coverage.missing),
      localGraph:{ entities:grounded.entities.map((entity) => entity.name), joins:grounded.joins },
      events,
      usage
    }
  };
}
