import fs from 'node:fs';
import path from 'node:path';
import { rankCoreEntities } from '../server/analysis/coreEntityRanking.js';

const mapFile = process.argv[2];
const limitArg = Number(process.argv[3] || 25);
if (!mapFile) {
  console.error('Usage: node scripts/rank-core-entities.js <semantic-map.json> [limit]');
  process.exit(2);
}
const resolved = path.resolve(mapFile);
const saved = JSON.parse(fs.readFileSync(resolved, 'utf8'));
const graph = Array.isArray(saved) ? saved : saved?.graph;
if (!Array.isArray(graph)) {
  console.error('Expected a saved semantic map containing a graph array.');
  process.exit(2);
}

const ranked = rankCoreEntities(graph, { limit:limitArg });
console.log(`[core-entity-ranking] map: ${resolved}`);
console.log(`[core-entity-ranking] entities ranked: ${ranked.length}\n`);
console.table(ranked.map((item, index) => ({
  rank:index + 1,
  entity:item.entity,
  role:item.role,
  score:item.coreScore,
  workflows:item.workflowCount,
  functional:item.functionalWorkflowCount,
  supporting:item.supportingWorkflowCount,
  technical:item.technicalWorkflowCount,
  stages:item.businessStageCount,
  degree:item.relationshipDegree,
  evidenced:item.evidencedRelationshipDegree,
  handoffs:item.crossWorkflowNeighbourCount
})));

if (process.env.LEMAP_CORE_ENTITY_JSON === '1') {
  console.log('\nJSON');
  console.log(JSON.stringify(ranked, null, 2));
}
