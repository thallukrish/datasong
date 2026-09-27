import fs from 'node:fs';
import path from 'node:path';
import { rankCoreEntities } from '../analysis/coreEntityRanking.js';

const arr = (v) => Array.isArray(v) ? v : [];
const normRepo = (v) => String(v || '').trim().replace(/\/$/,'').toLowerCase();
const compact = (v,max=260) => String(v || '').trim().replace(/\s+/g,' ').slice(0,max);
const uniq = (v) => [...new Set(arr(v).filter(Boolean).map(String))];

function latestMatchingMap(dataRoot, repoUrl) {
  const dir=path.join(dataRoot,'semantic-maps');
  if(!fs.existsSync(dir)) return null;
  const rows=fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(name=>{
    const file=path.join(dir,name);
    try{
      const stat=fs.statSync(file);
      const saved=JSON.parse(fs.readFileSync(file,'utf8'));
      return {file,mtime:stat.mtimeMs,saved};
    }catch{return null;}
  }).filter(Boolean)
    .filter(x=>normRepo(x.saved?.repoUrl)===normRepo(repoUrl))
    .sort((a,b)=>b.mtime-a.mtime);
  return rows[0]||null;
}

function roleWeight(role){
  if(role==='core') return 3;
  if(role==='supporting') return 1;
  if(role==='incidental') return .1;
  return 0;
}

function coreWorkflows(graph, limit=10){
  return arr(graph).filter(n=>n?.type==='workflow').map(w=>{
    const role=String(w?.data?.functionalRole||'').toLowerCase();
    const priority=Number(w?.data?.businessPriority||0);
    return {
      id:w.id,
      title:compact(w.name,180),
      functionalRole:role||'unclassified',
      functionalRoleConfidence:Number(w?.data?.functionalRoleConfidence||0),
      functionalRoleReason:compact(w?.data?.functionalRoleReason,320),
      intent:compact(w?.data?.intent,260),
      outcome:compact(w?.data?.outcome,260),
      score:roleWeight(role)*100 + Math.max(0,Math.min(100,priority))
    };
  }).filter(w=>w.functionalRole==='core'||w.functionalRole==='supporting')
    .sort((a,b)=>b.score-a.score||b.functionalRoleConfidence-a.functionalRoleConfidence)
    .slice(0,limit)
    .map(({score,...w})=>w);
}

function frameworkContext(topology){
  const kind=String(topology?.frameworkKind||'').toLowerCase();
  if(kind==='odoo'){
    const detection=topology?.odooDetection||{};
    const addons=arr(detection.addons);
    const projectAddons=uniq(addons.map(a=>a?.name)).slice(0,30);
    const dependencies=uniq(addons.flatMap(a=>arr(a?.depends))).slice(0,40);
    const learnedModules=uniq(topology?.odooFrameworkSummary?.()?.modules).slice(0,40);
    return {
      name:'Odoo',
      version:compact(detection.version,40),
      projectAddons,
      modules:uniq([...learnedModules,...dependencies]).slice(0,40),
      source:'repository framework detection'
    };
  }
  if(kind==='moqui') return {name:'Moqui',version:'',projectAddons:[],modules:[],source:'repository framework detection'};
  return {name:compact(kind,80),version:'',projectAddons:[],modules:[],source:kind?'repository framework detection':''};
}

export function buildPlannerGrounding({dataRoot,repoUrl,topology,entityLimit=12,workflowLimit=10}){
  const matched=latestMatchingMap(dataRoot,repoUrl);
  const graph=arr(matched?.saved?.graph);
  const entities=graph.length?rankCoreEntities(graph,{limit:entityLimit}).map(e=>({
    name:e.entity,
    role:e.role,
    coreScore:e.coreScore,
    coreWorkflowCount:e.functionalWorkflowCount,
    supportingWorkflowCount:e.supportingWorkflowCount,
    incidentalWorkflowCount:e.incidentalWorkflowCount,
    description:compact(e.description,260)
  })):[];
  return {
    framework:frameworkContext(topology),
    learned:{
      mapFound:!!matched,
      mapFile:matched?path.basename(matched.file):'',
      coreWorkflows:graph.length?coreWorkflows(graph,workflowLimit):[],
      coreEntities:entities
    }
  };
}
