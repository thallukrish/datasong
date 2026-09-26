import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { modelJson } from '../query_v2/modelJson.js';

const arr = (v) => Array.isArray(v) ? v : [];
const text = (v, max=500) => String(v || '').trim().replace(/\s+/g,' ').slice(0,max);
const ROLES = new Set(['core','supporting','incidental','technical']);

function nodesById(graph){ return new Map(arr(graph).filter(n=>n?.id).map(n=>[n.id,n])); }

export function workflowSummaries(graph=[]){
  const byId=nodesById(graph);
  return arr(graph).filter(n=>n?.type==='workflow').map(w=>{
    const steps=arr(w.links)
      .filter(l=>l?.relationship==='contains step')
      .map(l=>byId.get(l.nodeId)).filter(Boolean)
      .sort((a,b)=>Number(a?.data?.order||0)-Number(b?.data?.order||0))
      .map(s=>({name:text(s.name,140),description:text(s?.data?.description,260),effect:text(s?.data?.effect,220)}));
    const entities=arr(w.links)
      .filter(l=>l?.relationship==='uses entity')
      .map(l=>byId.get(l.nodeId)).filter(n=>n?.type==='entity')
      .map(n=>n.name).filter(Boolean);
    return {
      id:w.id,
      title:text(w.name,180),
      actor:text(w?.data?.actor,180),
      intent:text(w?.data?.intent,300),
      trigger:text(w?.data?.trigger,260),
      outcome:text(w?.data?.outcome,300),
      priorityClass:text(w?.data?.priorityClass,60),
      businessPriority:Number.isFinite(Number(w?.data?.businessPriority))?Number(w.data.businessPriority):null,
      steps:steps.slice(0,20),
      entities:[...new Set(entities)].slice(0,24)
    };
  });
}

function normalize(item){
  return {
    id:String(item?.id||''),
    functionalRole:ROLES.has(item?.functionalRole)?item.functionalRole:'incidental',
    confidence:Math.max(0,Math.min(1,Number(item?.confidence||0))),
    reason:text(item?.reason,360)
  };
}

export async function classifyWorkflowRoles({
  graph=[], enterpriseName='', enterpriseDescription='', client, model='deepseek-v4-flash',
  batchSize=20, log=()=>{}
}){
  if(!client) throw new Error('A reasoning client is required to classify workflow roles.');
  if(!String(enterpriseDescription||'').trim()) throw new Error('Enterprise description is required for workflow role classification.');
  const workflows=workflowSummaries(graph);
  const results=[];
  for(let offset=0;offset<workflows.length;offset+=batchSize){
    const batch=workflows.slice(offset,offset+batchSize);
    const system=`Classify learned enterprise workflows by their FUNCTIONAL ROLE in this specific enterprise.

Use the enterprise/business description as the primary context for what this enterprise actually does.
Classify every supplied workflow as exactly one of:
- core: directly implements a primary value-producing or primary operating capability of this enterprise.
- supporting: enables, controls, maintains, measures, or supports core operations but is not itself a primary enterprise capability.
- incidental: valid application/business behavior that may be useful but is peripheral to the enterprise's main capabilities.
- technical: framework, infrastructure, configuration, security, metadata, developer plumbing, generic administration, or implementation mechanics.

Important:
- This is NOT an exploration-priority ranking.
- Do not call a workflow core merely because it is complex, central in the code graph, or touches many entities.
- Existing priorityClass/businessPriority are hints only and must not override the enterprise description.
- Generic ERP capabilities may be incidental or supporting if they are not central to this enterprise's stated business.
- Judge the workflow itself, not the importance of individual entities mentioned inside it.
- Use only the supplied evidence. Do not invent enterprise capabilities.

Return JSON exactly as:
{"roles":[{"id":"exact workflow id","functionalRole":"core|supporting|incidental|technical","confidence":0.0,"reason":"short enterprise-specific reason"}]}`;
    const payload={
      enterprise:{name:text(enterpriseName,160),description:text(enterpriseDescription,4000)},
      workflows:batch
    };
    const call=await modelJson(client,model,system,payload);
    const validIds=new Set(batch.map(w=>w.id));
    const batchRoles=arr(call.parsed?.roles).map(normalize).filter(r=>validIds.has(r.id));
    const byId=new Map(batchRoles.map(r=>[r.id,r]));
    for(const workflow of batch){
      results.push(byId.get(workflow.id)||{
        id:workflow.id,functionalRole:'incidental',confidence:0,
        reason:'Classifier did not return this workflow; conservative fallback.'
      });
    }
    log({offset,count:batch.length,usage:call.usage});
  }
  return results;
}

export function applyWorkflowRoles(graph=[],roles=[]){
  const roleById=new Map(arr(roles).map(r=>[r.id,r]));
  let updated=0;
  for(const node of arr(graph)){
    if(node?.type!=='workflow') continue;
    const role=roleById.get(node.id);
    if(!role) continue;
    node.data={...(node.data||{}),
      functionalRole:role.functionalRole,
      functionalRoleConfidence:role.confidence,
      functionalRoleReason:role.reason,
      functionalRoleModelVersion:'enterprise-functional-role-v1'
    };
    updated+=1;
  }
  return updated;
}

export function latestEnterpriseContext({dataRoot,repoUrl}){
  const dir=path.join(dataRoot,'query-runs-v5','investigations');
  if(!fs.existsSync(dir)) return null;
  const norm=v=>String(v||'').trim().replace(/\/$/,'').toLowerCase();
  const rows=fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(name=>{
    const file=path.join(dir,name);
    try{return {file,mtime:fs.statSync(file).mtimeMs,data:JSON.parse(fs.readFileSync(file,'utf8'))};}catch{return null;}
  }).filter(Boolean)
    .filter(x=>norm(x.data?.repoUrl)===norm(repoUrl))
    .filter(x=>String(x.data?.enterpriseContext?.description||'').trim())
    .sort((a,b)=>b.mtime-a.mtime);
  return rows[0]?.data?.enterpriseContext||null;
}

export function makeClient(){
  if(!process.env.DEEPSEEK_API_KEY) return null;
  return new OpenAI({apiKey:process.env.DEEPSEEK_API_KEY,baseURL:'https://api.deepseek.com',timeout:60_000});
}
