import fs from 'node:fs';
import path from 'node:path';
import { arr, key } from '../query_v2/modelJson.js';
import { planQueryV5 } from './causalPlanner.js';
import { matchCausalEdgeToWorkflows } from './workflowMatcher.js';
import { deriveEntityGraphForEdge } from './entityGraph.js';
import { createInvestigationStore } from './investigationStore.js';
import { createCausalFragmentStore } from './fragmentStore.js';

function isBusinessWorkflow(workflow) {
  const marks=[workflow?.classification,workflow?.qualification,workflow?.pathNature,workflow?.evidenceClassification].map(v=>String(v||'').toLowerCase());
  if(marks.some(v=>v==='technical'||v==='technical_flow'||v.includes('not_business'))) return false;
  return workflow?.qualifiesAsBusinessUseCase!==false;
}
function normRepo(v){ return String(v||'').trim().replace(/\/$/,'').toLowerCase(); }
function workflowOverview(workflows){
  return arr(workflows).map(w=>({id:w.id,title:w.title,businessIntent:w.businessIntent,businessOutcome:w.businessOutcome||w.outcome})).slice(0,40);
}
function mapVersion(snapshot={}){
  return String(snapshot?.mapPersistence?.savedAt || snapshot?.mapPersistence?.version || snapshot?.updatedAt || snapshot?.commit || 'unknown');
}
function edgeFingerprint(record,edge,kind,detail=''){
  return key([record.question,record.repoUrl,record.mapVersion,edge.id,edge.from,edge.to,kind,detail].join('|'));
}
function progressOf(record){
  const required=arr(record?.causalGraph?.edges).filter(e=>e.required!==false);
  const done=required.filter(e=>['workflow_supported','entity_connected'].includes(e.status));
  const entity=required.filter(e=>e.status==='entity_connected');
  return { requiredEdges:required.length, workflowSupported:done.length, entityConnected:entity.length,
    percent:required.length?Math.round((entity.length/required.length)*100):100 };
}
function publicRecord(record){
  return {...record,progress:progressOf(record)};
}
function structuralComplete(record){
  const required=arr(record?.causalGraph?.edges).filter(e=>e.required!==false);
  return required.length>0 && required.every(e=>e.status==='entity_connected');
}

export function registerQueryV5Api({ app, explorer, queryClient, queryModel, dataRoot, onLatestLog=()=>{} }) {
  const store=createInvestigationStore(dataRoot);
  const fragments=createCausalFragmentStore(dataRoot);
  const logsDir=path.join(dataRoot,'query-runs-v5');
  fs.mkdirSync(logsDir,{recursive:true});
  const runLog=()=>path.join(logsDir,`${new Date().toISOString().replace(/[:.]/g,'-')}.jsonl`);
  const append=(file,type,payload={})=>fs.appendFileSync(file,`${JSON.stringify({type,timestamp:new Date().toISOString(),...payload})}\n`,'utf8');

  app.get('/api/query-map-v5/investigations',(req,res)=>{
    const repo=normRepo(req.query.repoUrl);
    const rows=store.list().filter(r=>!repo||normRepo(r.repoUrl)===repo).map(r=>({
      id:r.id,question:r.question,status:r.status,mode:r.mode,updatedAt:r.updatedAt,createdAt:r.createdAt,progress:progressOf(r)
    }));
    res.json({investigations:rows});
  });
  app.get('/api/query-map-v5/investigations/:id',(req,res)=>{
    const record=store.get(req.params.id);
    if(!record)return res.status(404).json({error:'Investigation not found'});
    res.json(publicRecord(record));
  });
  app.post('/api/query-map-v5/:id/pause',(req,res)=>{
    const record=store.get(req.params.id); if(!record)return res.status(404).json({error:'Investigation not found'});
    const saved=store.save({...record,status:'paused'}); res.json(publicRecord(saved));
  });

  app.post('/api/query-map-v5',async(req,res)=>{
    const logFile=runLog(); onLatestLog(logFile);
    try{
      if(!queryClient)return res.status(503).json({error:'The reasoning service is not configured'});
      const phase=String(req.body?.phase||'plan');
      const snapshot=explorer.snapshot();
      const workflows=arr(snapshot?.pass1Arcs).filter(isBusinessWorkflow);
      const matching=normRepo(req.body?.repoUrl)===normRepo(snapshot.repoUrl);
      const enterpriseContext=matching?{name:String(req.body?.enterpriseName||''),description:String(req.body?.enterpriseDescription||'')}:{name:'',description:''};

      if(phase==='plan'){
        const question=String(req.body?.question||'').trim();
        if(!question)return res.status(400).json({error:'question is required'});
        const usage={prompt:0,completion:0,total:0};
        const plan=await planQueryV5({question,client:queryClient,model:queryModel,enterpriseContext,processOverview:workflowOverview(workflows),
          guidance:String(req.body?.planningGuidance||''),usage,log:(t,p)=>append(logFile,t,p)});
        const record=store.create({question,mode:plan.mode,repoUrl:snapshot.repoUrl||'',commit:snapshot.commit||'',
          observation:plan.observation,successCriterion:plan.successCriterion,causalGraph:plan.causalGraph,retrievalPlan:plan.retrievalPlan,
          grain:plan.grain,notes:plan.notes,usage,enterpriseContext,mapVersion:mapVersion(snapshot)});
        append(logFile,'query_v5_plan_ready',{investigationId:record.id,mode:record.mode,edgeCount:arr(record.causalGraph?.edges).length});
        return res.json({status:'plan_review',investigation:publicRecord(record)});
      }

      if(!['explore','resume'].includes(phase))return res.status(400).json({error:'Invalid Query V5 phase'});
      const id=String(req.body?.investigationId||'');
      let record=store.get(id); if(!record)return res.status(404).json({error:'Investigation not found'});
      if(normRepo(record.repoUrl)!==normRepo(snapshot.repoUrl))return res.status(409).json({error:'Enterprise map changed. Open the saved investigation against its original enterprise or create a new investigation.'});
      if(record.mode==='retrieval'){
        record=store.save({...record,status:'completed',completionReason:'Retrieval structure planned. Entity/table execution is intentionally deferred in Query V5.'});
        return res.json(publicRecord(record));
      }

      const currentMapVersion=mapVersion(snapshot);
      record={...record,status:'exploring',commit:snapshot.commit||record.commit,mapVersion:currentMapVersion};
      const nodesById=new Map(arr(record.causalGraph?.nodes).map(n=>[n.id,n]));
      const edges=arr(record.causalGraph?.edges).map(e=>({...e}));
      const usage=record.usage||{prompt:0,completion:0,total:0};
      const learningRequests=[...arr(record.learningRequests)];

      for(const edge of edges){
        if(edge.status==='entity_connected'||edge.status==='contradicted')continue;
        // Do not bounce Query ↔ Learn over the same unresolved branch when the
        // semantic map has not changed. Resume becomes meaningful after Learn
        // writes new evidence (or a future user-guidance revision changes it).
        if(edge.status==='unresolved' && edge.lastMapVersion===currentMapVersion){
          append(logFile,'query_v5_branch_unchanged',{edgeId:edge.id,mapVersion:currentMapVersion});
          continue;
        }
        const reusable=fragments.match(edge,nodesById,record.repoUrl);
        let workflowEvidence=[];
        if(reusable.length){
          workflowEvidence=arr(reusable[0].workflowEvidence).map(w=>({...w,reusedFrom:reusable[0].sourceInvestigationId,reuseScore:reusable[0].reuseScore}));
          append(logFile,'query_v5_fragment_reused',{edgeId:edge.id,sourceInvestigationId:reusable[0].sourceInvestigationId,reuseScore:reusable[0].reuseScore});
        }else{
          const match=await matchCausalEdgeToWorkflows({edge,nodesById,workflows,client:queryClient,model:queryModel,usage,log:(t,p)=>append(logFile,t,p)});
          workflowEvidence=match.matches;
        }
        edge.workflowEvidence=workflowEvidence;
        edge.lastMapVersion=currentMapVersion;
        const best=Math.max(...workflowEvidence.map(x=>Number(x.confidence||0)),0);
        if(!workflowEvidence.length||best<0.55){
          edge.status='unresolved';
          edge.missing=['No sufficiently supported learned workflow for this causal transition'];
          const fp=edgeFingerprint(record,edge,'workflow_transition',edge.missing.join('|'));
          if(!record.exhaustedFingerprints?.includes(fp)&&!learningRequests.some(x=>x.fingerprint===fp)){
            learningRequests.push({id:`learn-${edge.id}-workflow`,fingerprint:fp,edgeId:edge.id,kind:'workflow_transition',
              objective:`Find a workflow transition connecting "${nodesById.get(edge.from)?.label||edge.from}" to "${nodesById.get(edge.to)?.label||edge.to}" for hypothesis: ${edge.hypothesis}`,
              evidenceRequired:edge.evidenceRequired,status:'pending'});
          }
          continue;
        }
        edge.status='workflow_supported';
        const entityGraph=deriveEntityGraphForEdge({edge,workflowEvidence,workflows});
        edge.entityEvidence=[entityGraph];
        edge.missing=entityGraph.missing;
        if(entityGraph.entities.length && entityGraph.missing.length===0)edge.status='entity_connected';
        else{
          edge.status='unresolved';
          const detail=entityGraph.missing.join('|')||'entity-stage binding';
          const fp=edgeFingerprint(record,edge,'entity_relationship',detail);
          if(!record.exhaustedFingerprints?.includes(fp)&&!learningRequests.some(x=>x.fingerprint===fp)){
            learningRequests.push({id:`learn-${edge.id}-entity`,fingerprint:fp,edgeId:edge.id,kind:'entity_relationship',
              objective:`Resolve entity/stage relationships for causal edge "${edge.hypothesis}"`,missing:entityGraph.missing,status:'pending'});
          }
        }
      }

      const graph={...record.causalGraph,edges};
      record={...record,causalGraph:graph,learningRequests,usage};
      if(structuralComplete(record)){
        record={...record,status:'completed',completionReason:'Original causal graph fulfillment contract met with workflow and entity evidence.'};
        record=store.save(record); fragments.upsertFromInvestigation(record);
      }else{
        const pending=learningRequests.filter(x=>x.status==='pending');
        record=store.save({...record,status:pending.length?'needs_user_input':'exhausted',
          completionReason:pending.length?'Specific workflow/entity evidence gaps remain.':'No novel supported path remains for unresolved causal edges.'});
      }
      append(logFile,'query_v5_exploration_complete',{investigationId:record.id,status:record.status,progress:progressOf(record),learningRequests:record.learningRequests,usage});
      return res.json(publicRecord(record));
    }catch(error){
      append(logFile,'query_v5_error',{error:error.message||String(error)});
      console.error(`[lemap query-v5] ${error.message||error}`);
      return res.status(500).json({error:error.message||'Query V5 failed'});
    }
  });
  console.log('[DataSong v2] QUERY V5: causal graph → workflow evidence → derived entity graph → /api/query-map-v5');
}
