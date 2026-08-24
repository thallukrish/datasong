import { acceptedGraph, buildGraphIndex, buildSemanticFieldHints } from './graphContext.js';
import { deriveQueryDimensions, exploreSemanticDfs } from './dfsExplorer.js';
import { buildSemanticHierarchy } from './semanticHierarchy.js';
import { addUsage, modelJson } from './modelJson.js';

const FINAL_SYSTEM = `Answer using ONLY the accepted semantic DFS trail and evidenced joins supplied. Never invent a field or join. If exploration is incomplete, say that exploration is incomplete and name the still-uncovered query dimensions; do not claim the schema lacks them. Return {"answer":"concise","dataView":{"grain":"","select":[{"entity":"","field":"","role":"measure|dimension|time|filter|attribute|derived"}],"joins":[{"left":"Entity.field","right":"Entity.field","relation":"","evidenced":true}],"groupBy":[],"orderBy":[],"filters":[],"derived":[],"missing":[]},"nextStep":"optional"}.`;

function finalPayload(question, logicalRequest, exploration, graph) {
  return {
    question,
    logicalRequest,
    explorationStatus:{
      complete:exploration.complete,
      connected:exploration.connected,
      missingDimensions:exploration.coverage.missing,
      steps:exploration.steps
    },
    acceptedEntities:exploration.accepted,
    evidencedGraph:graph
  };
}

export async function runSemanticDfsQuery({ question, client, model, graph, directory, log = () => {} }) {
  const usage = { prompt:0, completion:0, total:0 };
  const index = buildGraphIndex(graph);
  const semanticHints = buildSemanticFieldHints(index.entities);
  const hierarchy = buildSemanticHierarchy(directory, index.entities);

  console.log(`[lemap query-v2] semantic DFS: ${hierarchy.clusters.length} clusters, ${index.entities.size} graph entities`);

  const logicalRequest = await deriveQueryDimensions({ question, client, model, log, usage });
  console.log(`[lemap query-v2] query dimensions: ${logicalRequest.dimensions.map((item) => item.name).join(', ') || '(none)'}`);

  const exploration = await exploreSemanticDfs({
    question,
    logicalRequest,
    hierarchy,
    index,
    semanticHints,
    client,
    model,
    log,
    usage
  });

  console.log(`[lemap query-v2] DFS complete=${exploration.complete}; steps=${exploration.steps}; accepted=${exploration.accepted.map((item) => item.entity).join(', ') || '(none)'}; missing=${exploration.coverage.missing.join(', ') || '(none)'}`);
  log('query_v2_dfs_complete', {
    complete:exploration.complete,
    connected:exploration.connected,
    steps:exploration.steps,
    accepted:exploration.accepted,
    rejected:exploration.rejected,
    coverage:exploration.coverage,
    stack:exploration.stack,
    traversedJoins:exploration.traversedJoins,
    events:exploration.events
  });

  const grounded = acceptedGraph(
    new Map(exploration.accepted.map((item) => [item.entity.toLowerCase(), item])),
    new Map(exploration.traversedJoins.map((join, indexValue) => [String(indexValue), join])),
    index
  );

  const finalCall = await modelJson(client, model, FINAL_SYSTEM, finalPayload(question, logicalRequest, exploration, grounded), { maxTokens:1400 });
  addUsage(usage, finalCall.usage);
  log('query_v2_answer', { response:finalCall.parsed, usage:finalCall.usage, cumulativeUsage:usage });

  console.log(`[lemap query-v2] final answer tokens ${finalCall.usage.total}; total ${usage.total}`);

  return {
    ...finalCall.parsed,
    investigation:{
      mode:'confidence-ordered-semantic-dfs',
      logicalRequest,
      hierarchy:{ clusterCount:hierarchy.clusters.length },
      dfs:{
        complete:exploration.complete,
        connected:exploration.connected,
        steps:exploration.steps,
        coverage:exploration.coverage,
        accepted:exploration.accepted,
        rejected:exploration.rejected,
        stack:exploration.stack,
        events:exploration.events
      },
      localGraph:{
        entities:grounded.entities.map((entity) => entity.name),
        joins:grounded.joins
      },
      usage
    }
  };
}
