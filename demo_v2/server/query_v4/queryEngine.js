import { acceptedGraph, buildGraphIndex, buildSemanticFieldHints } from '../query_v2/graphContext.js';
import { buildSemanticHierarchy } from '../query_v2/semanticHierarchy.js';
import { addUsage, arr, key, modelJson } from '../query_v2/modelJson.js';
import { Frontier } from '../query_v3/frontier.js';
import { activeScore } from '../query_v3/pathScore.js';
import { connectEvidenceEntities } from './connectivity.js';
import { deriveDimensions, scoreNextStates } from './scorer.js';
import { coverageState, evaluateEntityCoverage } from './coverage.js';
import { expandLinkedEntities, expandState, rootStates } from './stateExpander.js';

const MAX_STEPS = 64;
const FINAL_SYSTEM = `Answer using ONLY the evidence-backed entities and evidenced joins supplied. Evidence bindings may be fields or simple expressions over supplied fields. Join fields may appear only from supplied keyMaps. LeMap's supplied connectivity paths and joins are structurally evidenced and authoritative; do not second-guess whether connected entities are related.

Your job is to construct the best executable answer from the grounded evidence and state semantic uncertainty explicitly. If a required concept is not explicitly confirmed but there is one best-supported coherent evidence choice and no stronger contradictory evidence, use it and add a qualifier instead of rejecting the answer. This includes a business-event attribute on an evidenced parent/header entity when it coherently characterizes the child/detail observation, for example an order header placedDate used as the transaction date for its order items. Do not invent fields, joins, constants, or business logic. A generic lifecycle timestamp should not be treated as business-event time unless the supplied evidence supports that meaning.

Use qualifier confidence "confirmed" when the semantics are explicit and "probable" when the interpretation is the strongest coherent available evidence but inferred. If exploration is incomplete or deterministic connectivity is incomplete, say so and put genuinely unsupported requirements in dataView.missing. Return {"answer":"concise","dataView":{"grain":"","select":[{"entity":"","field":"field-or-expression","role":"dimension|measure|time|filter|attribute|derived"}],"joins":[{"left":"Entity.joinField","right":"Entity.joinField","relation":"","evidenced":true}],"missing":[]},"qualifiers":[{"concept":"","field":"Entity.field-or-expression","confidence":"confirmed|probable","note":"short user-facing qualification"}],"nextStep":"optional"}.`;

function joinSignature(join) {
  return `${key(join?.from)}|${key(join?.to)}|${key(join?.relationship)}|${arr(join?.keyMaps).map((m) => `${key(m.fieldName)}:${key(m.relatedFieldName)}`).join(',')}`;
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

function entityArrival(path, current, missingDimensions) {
  const states = arr(path?.states);
  const parent = states.length > 1 ? states[states.length - 2] : null;
  const score = { ...(path?.score || {}) };
  return {
    entity:current?.entityName || current?.name || '',
    path:states.map((state) => state.name),
    parent:parent?.name || '',
    arrivalEdge:current?.edge || null,
    inheritedScore:score,
    unresolvedScores:Object.fromEntries(arr(missingDimensions)
      .filter((dimension) => Number.isFinite(Number(score?.[dimension])))
      .map((dimension) => [dimension, Number(score[dimension])])),
    priority:activeScore(score, missingDimensions),
    missingDimensions:arr(missingDimensions)
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
  const groundedAccepted = new Map([...accepted]
    .filter(([, item]) => arr(item.covered).length)
    .map(([k, item]) => [k, { entity:item.entity }]));
  for (const entityKey of connectorEntities) {
    if (groundedAccepted.has(entityKey)) continue;
    const entity = index.entities.get(entityKey);
    if (entity) groundedAccepted.set(entityKey, { entity:entity.name });
  }
  return acceptedGraph(groundedAccepted, traversedJoins, index);
}

function mergeCoverage({ accepted, entityName, covered, pathNames, events, step, action = 'coverage' }) {
  const entityKey = key(entityName);
  const existing = accepted.get(entityKey) || { entity:entityName, covered:[], paths:[] };
  const byDimension = new Map(arr(existing.covered).map((item) => [key(item.dimension), item]));
  for (const item of arr(covered)) if (!byDimension.has(key(item.dimension))) byDimension.set(key(item.dimension), item);
  existing.covered = [...byDimension.values()];
  if (!existing.paths.some((p) => p.join('>') === pathNames.join('>'))) existing.paths.push(pathNames);
  accepted.set(entityKey, existing);
  if (arr(covered).length) events.push({ step, action, entity:entityName, covered });
}

function pruneUnconnectedEvidence(accepted, connectivity) {
  const unconnected = new Set(arr(connectivity?.unconnected).map(key));
  if (!unconnected.size) return [];
  const reopened = [];
  for (const item of accepted.values()) {
    if (!unconnected.has(key(item.entity))) continue;
    for (const coverage of arr(item.covered)) reopened.push(coverage.dimension);
    item.covered = [];
  }
  return [...new Set(reopened)];
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
  let lastConnectivityCoverage = '';

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
      const signature = [...accepted.values()]
        .filter((item) => arr(item.covered).length)
        .map((item) => `${key(item.entity)}:${arr(item.covered).map((c) => key(c.dimension)).sort().join(',')}`)
        .sort().join('|');
      if (signature !== lastConnectivityCoverage) {
        connectorEntities.clear();
        connectivity = runConnectivity({ accepted, index, traversedJoins, connectorEntities, events, log, step:++stepRef.value });
        lastConnectivityCoverage = signature;
      }

      if (connectivity?.connected) break;

      const structurallyReopened = pruneUnconnectedEvidence(accepted, connectivity);
      if (structurallyReopened.length) {
        const event = {
          step:++stepRef.value,
          action:'connectivity_reopen',
          reopened:structurallyReopened,
          unconnected:arr(connectivity?.unconnected)
        };
        events.push(event);
        log('query_v4_connectivity_reopen', event);
        connectivity = null;
        lastConnectivityCoverage = '';
        coverage = coverageState(dimensions, accepted);
      }
    }

    coverage = coverageState(dimensions, accepted);
    const searchNeeds = coverage.missing.length ? coverage.missing : dimensions;

    if (!frontier.size && frontier.dormantSize) {
      await activateDormant({ frontier, logicalRequest, dimensions, missingDimensions:searchNeeds, client, model, usage, log, stepRef });
      if (!frontier.size) continue;
    }

    const path = frontier.popBest(searchNeeds);
    if (!path) continue;
    const current = path.states.at(-1);
    events.push({
      step:stepRef.value,
      action:'select_path',
      seedSource:path.states[0]?.type === 'workflow' ? 'workflow' : 'directory',
      ...compactPath(path, searchNeeds),
      frontierSize:frontier.size,
      dormantSize:frontier.dormantSize
    });
    console.log(`[lemap query-v4][${stepRef.value}] ${path.states.map((state) => state.name).join(' → ')} | priority ${activeScore(path.score, searchNeeds).toFixed(2)} | missing ${coverage.missing.join(', ') || '-'} | frontier ${frontier.size}+${frontier.dormantSize}`);

    for (const join of arr(path.joins)) traversedJoins.set(joinSignature(join), join);

    if (current.type === 'entity' && current.entityName) {
      const fkCandidates = expandLinkedEntities(current, {
        hierarchy,
        index,
        semanticHints,
        visitedEntityKeys:selectedEntityKeys(path)
      });
      const arrival = {
        step:stepRef.value + 1,
        action:'entity_arrival',
        ...entityArrival(path, current, searchNeeds),
        fkCandidateCount:fkCandidates.length
      };
      events.push(arrival);
      log('query_v4_entity_arrival', arrival);
      console.log(`[lemap query-v4][${arrival.step}] inspect ${arrival.entity} | arrived from ${arrival.parent || 'root'} | inherited ${JSON.stringify(arrival.unresolvedScores)} | FKs ${arrival.fkCandidateCount}`);

      const inspection = await evaluateEntityCoverage({
        state:current,
        dimensions,
        missingDimensions:searchNeeds,
        fkCandidates,
        intent:logicalRequest.intent,
        client,
        model,
        usage,
        log,
        step:++stepRef.value,
        repairContext:null
      });

      mergeCoverage({
        accepted,
        entityName:current.entityName,
        covered:inspection.covered,
        pathNames:path.states.map((state) => state.name),
        events,
        step:stepRef.value
      });

      const followed = inspection.follow.map((item) => nextPath(path, item));
      frontier.add(followed);
      if (followed.length) {
        events.push({
          step:stepRef.value,
          action:'entity_follow',
          from:current.name,
          targets:followed.map((next) => ({ entity:next.states.at(-1).name, score:next.score }))
        });
      }
      continue;
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
      missingDimensions:searchNeeds,
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
      candidates:nextPaths.map((item) => compactPath(item, searchNeeds)),
      omitted:scored.omitted.map((state) => state.name),
      frontierSize:frontier.size,
      dormantSize:frontier.dormantSize
    });
  }

  const coverage = coverageState(dimensions, accepted);
  if (!coverage.missing.length && !connectivity) {
    connectorEntities.clear();
    connectivity = runConnectivity({ accepted, index, traversedJoins, connectorEntities, events, log, step:++stepRef.value, phase:'final' });
  }
  const connected = !coverage.missing.length && !!connectivity?.connected;
  const complete = !coverage.missing.length && connected;
  const grounded = groundedGraph({ accepted, connectorEntities, traversedJoins, index });

  log('query_v4_search_complete', {
    complete,
    connected,
    coverage,
    accepted:[...accepted.values()],
    connectivity,
    joins:[...traversedJoins.values()],
    frontier:frontier.snapshot(coverage.missing.length ? coverage.missing : dimensions),
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
      mode:'semantic-best-first-workflow-fk-guided-v4',
      logicalRequest,
      complete,
      connected,
      steps:stepRef.value,
      coverage,
      accepted:[...accepted.values()],
      connectivity,
      frontier:frontier.snapshot(coverage.missing.length ? coverage.missing : dimensions),
      localGraph:{ entities:grounded.entities.map((entity) => entity.name), joins:grounded.joins },
      events,
      usage
    }
  };
}