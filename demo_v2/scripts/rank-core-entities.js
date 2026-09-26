import fs from 'node:fs';
import path from 'node:path';
import { rankCoreEntities } from '../server/analysis/coreEntityRanking.js';

function latestSemanticMap() {
  const dir=path.resolve(process.cwd(),'data','semantic-maps');
  if(!fs.existsSync(dir)) return '';
  const files=fs.readdirSync(dir)
    .filter(name=>name.endsWith('.json'))
    .map(name=>({file:path.join(dir,name),mtime:fs.statSync(path.join(dir,name)).mtimeMs}))
    .sort((a,b)=>b.mtime-a.mtime);
  return files[0]?.file || '';
}

const requested=process.argv[2] || '';
const limitArg=Number(process.argv[3] || 25);
const mapFile=requested ? path.resolve(requested) : latestSemanticMap();
if(!mapFile){
  console.error('No semantic map found.');
  console.error('Usage: npm run rank:core-entities -- [semantic-map.json] [limit]');
  console.error('If no file is supplied, the latest data/semantic-maps/*.json is used.');
  process.exit(2);
}
const saved=JSON.parse(fs.readFileSync(mapFile,'utf8'));
const graph=Array.isArray(saved) ? saved : saved?.graph;
if(!Array.isArray(graph)){
  console.error('Expected a saved semantic map containing a graph array.');
  process.exit(2);
}

const ranked=rankCoreEntities(graph,{limit:limitArg});
console.log(`[core-entity-ranking] map: ${mapFile}`);
console.log(`[core-entity-ranking] repository: ${saved?.repoUrl || '(unknown)'}`);
console.log(`[core-entity-ranking] commit: ${saved?.commit || '(unknown)'}`);
console.log(`[core-entity-ranking] entities ranked: ${ranked.length}\n`);
console.table(ranked.map((item,index)=>({
  rank:index+1,
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

console.log('\nTop ranking evidence');
for(const [index,item] of ranked.slice(0,Math.min(15,ranked.length)).entries()){
  console.log(`${index+1}. ${item.entity} [${item.role}] score=${item.coreScore}`);
  console.log(`   ${item.reasons.join('; ') || 'No strong ranking evidence'}`);
  if(item.workflows.length) console.log(`   workflows: ${item.workflows.join(' | ')}`);
}

if(process.env.LEMAP_CORE_ENTITY_JSON==='1'){
  console.log('\nJSON');
  console.log(JSON.stringify(ranked,null,2));
}
