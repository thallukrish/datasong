import fs from 'node:fs';
import path from 'node:path';
import {
  applyWorkflowRoles, classifyWorkflowRoles, latestEnterpriseContext, makeClient, workflowSummaries
} from '../server/analysis/workflowRoleClassifier.js';

function latestSemanticMap(){
  const dir=path.resolve(process.cwd(),'data','semantic-maps');
  if(!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(name=>{
    const file=path.join(dir,name); return {file,mtime:fs.statSync(file).mtimeMs};
  }).sort((a,b)=>b.mtime-a.mtime)[0]?.file||'';
}

const mapFile=process.argv[2]?path.resolve(process.argv[2]):latestSemanticMap();
if(!mapFile){
  console.error('No semantic map found.');
  console.error('Usage: npm run classify:workflow-roles -- [semantic-map.json]');
  process.exit(2);
}
const saved=JSON.parse(fs.readFileSync(mapFile,'utf8'));
if(!Array.isArray(saved?.graph)) throw new Error('Expected a persisted semantic map with graph array.');

const dataRoot=path.resolve(process.cwd(),'data');
const context=latestEnterpriseContext({dataRoot,repoUrl:saved.repoUrl});
const enterpriseDescription=process.env.LEMAP_ENTERPRISE_DESCRIPTION || context?.description || '';
const enterpriseName=process.env.LEMAP_ENTERPRISE_NAME || context?.name || '';
if(!enterpriseDescription){
  console.error('No enterprise description found in matching V5 investigations.');
  console.error('Set LEMAP_ENTERPRISE_DESCRIPTION and optionally LEMAP_ENTERPRISE_NAME, then rerun.');
  process.exit(2);
}
const client=makeClient();
if(!client){
  console.error('DEEPSEEK_API_KEY is required for workflow role classification.');
  process.exit(2);
}
const model=process.env.DEEPSEEK_MODEL||'deepseek-v4-flash';
const workflows=workflowSummaries(saved.graph);
console.log(`[workflow-role] map: ${mapFile}`);
console.log(`[workflow-role] repository: ${saved.repoUrl||'(unknown)'}`);
console.log(`[workflow-role] enterprise: ${enterpriseName||'(unnamed)'}`);
console.log(`[workflow-role] workflows: ${workflows.length}`);

const roles=await classifyWorkflowRoles({
  graph:saved.graph,enterpriseName,enterpriseDescription,client,model,
  log:({offset,count,usage})=>console.log(`[workflow-role] classified ${offset+1}-${offset+count}; tokens ${usage?.total||0}`)
});
console.table(roles.map((r,index)=>({rank:index+1,id:r.id,role:r.functionalRole,confidence:r.confidence,reason:r.reason})));

const backup=`${mapFile}.before-workflow-roles.bak`;
if(!fs.existsSync(backup)) fs.copyFileSync(mapFile,backup);
const updated=applyWorkflowRoles(saved.graph,roles);
saved.savedAt=new Date().toISOString();
fs.writeFileSync(mapFile,JSON.stringify(saved,null,2),'utf8');
console.log(`[workflow-role] updated ${updated} workflows`);
console.log(`[workflow-role] backup: ${backup}`);
console.log('[workflow-role] next: npm run rank:core-entities');
