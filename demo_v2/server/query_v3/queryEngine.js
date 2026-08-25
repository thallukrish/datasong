import { acceptedGraph, buildGraphIndex, buildSemanticFieldHints } from '../query_v2/graphContext.js';
import { buildSemanticHierarchy } from '../query_v2/semanticHierarchy.js';
import { addUsage, arr, key, modelJson } from '../query_v2/modelJson.js';
import { coverageState, evaluateEntityCoverage } from './coverage.js';
import { Frontier } from './frontier.js';
import { activeScore } from './pathScore.js';
import { deriveDimensions, scoreNextStates } from './scorer.js';
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

function compactPath(path, missing) {
  return {
    states:path.states.map((state) => state.name),
    score:path.score,
    priority:activeScore(path.score, missing),
    deltas:path.deltas || [],
    joins:path.joins || []
  };
}

export async function runSemanticBestFirstQuery({ question, client, model, graph, directory, log = () => {} }) {
  const usage = { prompt:0, completion:0, total:0 };
  const index = buildGraphIndex(graph);
  const semanticHints = buildSemanticFieldHints(index.entities);
  const hierarchy = buildSemanticHierarchy(directory, index.entities);
  const logicalRequest = await deriveDimensions({ question, client, model, usage, log });
  const dimensions = logicalRequest.dimensions.map((item) => item.name);
  const accepted = new Map();
  const traversedJoins = new Map();
  const frontier = new Frontier();
  const events = [];
  let step = 0;

  const roots = rootStates(hierarchy);
  const initial = await scoreNextStates({
    intent:logicalRequest.intent,
    dimensions,
    missingDimensions:dimensions,
    path:{ states:[], score:{} },
    candidates:roots,
    client, model, usage, log, step:++step
  });
  frontier.add(initial.scored.map((item) => ({ states:[item.state], score:item.score, deltas:[item.delta], joins:[] })));

  while (frontier.size && step < MAX_STEPS) {
    let coverage = coverageState(dimensions, accepted);
    let connected = acceptedConnected(accepted, traversedJoins);
    if (!coverage.missing.length && connected) break;

    const path = frontier.popBest(coverage.missing);
    if (!path) break;
    const current = path.states.at(-1);
    events.push({ step, action:'select_path', ...compactPath(path, coverage.missing), frontierSize:frontier.size });
    console.log(`[lemap query-v3][${step}] ${path.states.map((state) => state.name).join(' → ')} | priority ${activeScore(path.score, coverage.missing).toFixed(2)} | missing ${coverage.missing.join(', ') || '-'} | frontier ${frontier.size}`);

    for (const join of arr(path.joins)) traversedJoins.set(joinSignature(join), join);

    if (current.type === 'entity' && current.entityName) {
      const covered = await evaluateEntityCoverage({ state:current, dimensions, missingDimensions:coverage.missing, client, model, usage, log, step:++step });
      const entityKey = key(current.entityName);
      const existing = accepted.get(entityKey) || { entity:current.entityName, covered:[], paths:[] };
      const byDimension = new Map(arr(existing.covered).map((item) => [item.dimension, item]));
      for (const item of covered) {
        const prior = byDimension.get(item.dimension);
        if (!prior || item.confidence > prior.confidence) byDimension.set(item.dimension, item);
      }
      existing.covered = [...byDimension.values()];
      if (!existing.paths.some((p) => p.join('>') === path.states.map((state) => state.name).join('>'))) existing.paths.push(path.states.map((state) => state.name));
      accepted.set(entityKey, existing);
      if (covered.length) events.push({ step, action:'coverage', entity:current.entityName, covered });
      coverage = coverageState(dimensions, accepted);
      connected = acceptedConnected(accepted, traversedJoins);
      if (!coverage.missing.length && connected) break;
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
      client, model, usage, log, step:++step
    });
    const nextPaths = scored.scored.map((item) => {
      const join = item.state.edge?.kind === 'schema_fk' ? item.state.edge.join : null;
      return {
        states:[...path.states, item.state],
        score:item.score,
        deltas:[...(path.deltas || []), item.delta],
        joins:join ? [...(path.joins || []), join] : [...(path.joins || [])]
      };
    });
    frontier.add(nextPaths);
    events.push({ step, action:'expand', from:current.name, candidates:nextPaths.map((item) => compactPath(item, coverage.missing)), frontierSize:frontier.size });
  }

  const coverage = coverageState(dimensions, accepted);
  const connected = acceptedConnected(accepted, traversedJoins);
  const complete = !coverage.missing.length && connected;
  const grounded = acceptedGraph(
    new Map([...accepted].map(([k, item]) => [k, { entity:item.entity }])),
    traversedJoins,
    index
  );
  log('query_v3_search_complete', { complete, connected, coverage, accepted:[...accepted.values()], joins:[...traversedJoins.values()], frontier:frontier.snapshot(coverage.missing), events, cumulativeUsage:{...usage} });

  const finalPayload = {
    question,
    logicalRequest,
    status:{ complete, connected, missingDimensions:coverage.missing, steps:step },
    acceptedEntities:[...accepted.values()].filter((item) => item.covered.length),
    evidencedGraph:grounded
  };
  const finalCall = await modelJson(client, model, FINAL_SYSTEM, finalPayload, { maxTokens:900 });
  addUsage(usage, finalCall.usage);
  log('query_v3_answer', { response:finalCall.parsed, usage:finalCall.usage, cumulativeUsage:{...usage} });

  return {
    ...finalCall.parsed,
    investigation:{
      mode:'semantic-best-first-state-search-v3',
      logicalRequest,
      complete,
      connected,
      steps:step,
      coverage,
      accepted:[...accepted.values()],
      frontier:frontier.snapshot(coverage.missing),
      localGraph:{ entities:grounded.entities.map((entity) => entity.name), joins:grounded.joins },
      events,
      usage
    }
  };
}
