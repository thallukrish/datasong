import fs from 'node:fs';
import path from 'node:path';
import { runCodeFlowQueryV5 } from './queryEngine.js';

export function registerQueryV5Api({app,explorer,queryClient,queryModel,dataRoot,onLatestLog=()=>{}}){
  app.post('/api/query-map-v5',async(req,res)=>{
    const dir=path.join(dataRoot,'query-runs-v5');fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,new Date().toISOString().replace(/[:.]/g,'-')+'.jsonl');onLatestLog(file);
    const log=(type,payload={})=>fs.appendFileSync(file,JSON.stringify({type,timestamp:new Date().toISOString(),...payload})+'\\n','utf8');
    try{
      if(!queryClient)return res.status(503).json({error:'The reasoning service is not configured'});
      const question=String(req.body?.question||'').trim();if(!question)return res.status(400).json({error:'question is required'});
      const progress={running:true,question,mode:'',goals:[],activeGoalId:'',hypothesis:'',hypothesisScore:0,previousScore:0,delta:0,trend:'',bestScore:0,constraintChecklist:[],evidenceRanges:[],facts:[],explained:false,action:'START',path:[],candidates:[],learnNodes:[],tokens:{prompt:0,completion:0,total:0},events:[]};explorer.state.queryV5Progress=progress;explorer.emit?.();
      const onProgress=(event={})=>{
        const p=explorer.state.queryV5Progress||progress;
        if(typeof event.mode==='string')p.mode=event.mode;
        if(Array.isArray(event.goals))p.goals=event.goals;
        if(typeof event.goalId==='string')p.activeGoalId=event.goalId;
        if(typeof event.hypothesis==='string')p.hypothesis=event.hypothesis;
        if(Number.isFinite(Number(event.hypothesisScore)))p.hypothesisScore=Number(event.hypothesisScore);
        if(Number.isFinite(Number(event.previousScore)))p.previousScore=Number(event.previousScore);
        if(Number.isFinite(Number(event.delta)))p.delta=Number(event.delta);
        if(typeof event.trend==='string')p.trend=event.trend;
        if(Number.isFinite(Number(event.bestScore)))p.bestScore=Number(event.bestScore);
        if(Array.isArray(event.constraintChecklist))p.constraintChecklist=event.constraintChecklist;
        if(Array.isArray(event.evidenceRanges))p.evidenceRanges=event.evidenceRanges;
        if(Array.isArray(event.facts))p.facts=event.facts;
        if(typeof event.explained==='boolean')p.explained=event.explained;
        if(Array.isArray(event.path))p.path=event.path;
        if(event.action==='DECIDE'&&Array.isArray(event.candidates))p.candidates=event.candidates;
        if(event.tokens&&typeof event.tokens==='object')p.tokens=event.tokens;
        if(event.action==='LEARN_START')p.learnNodes=event.nodes||[];
        if(event.action==='LEARN_DONE')p.learnNodes=[];
        p.action=event.action||p.action;p.detail=event;
        if(['PREPARE_TOPOLOGY','TOPOLOGY_READY','GOALS','GOAL_ACTIVE','GOAL_SEARCH','GOAL_ENTRY_SELECTION','GOAL_ENTRY_BATCH','GOALS_RESOLVED','RESEED','DESCEND','BACKTRACK','BRANCH_PRUNED','DECIDE','HYPOTHESIS_PROGRESS','HYPOTHESIS_FLAT','FACTS','LEARN_START','LEARN_DONE','EXPLAINED'].includes(event.action))p.events=[...(p.events||[]),event].slice(-32);
        explorer.state.queryV5Progress=p;explorer.emit?.();
      };
      const result=await runCodeFlowQueryV5({question,repoUrl:String(req.body?.repoUrl||explorer.state?.repoUrl||''),repoCommit:String(req.body?.repoCommit||''),explorer,client:queryClient,model:queryModel,log,onProgress});
      explorer.state.queryV5Progress={...(explorer.state.queryV5Progress||progress),running:false,action:'DONE'};explorer.emit?.();
      return res.json(result);
    }catch(error){if(explorer.state)explorer.state.queryV5Progress={...(explorer.state.queryV5Progress||{}),running:false,action:'ERROR',error:error.message||String(error)};explorer.emit?.();log('query_v5_error',{error:error.message||String(error)});return res.status(500).json({error:error.message||'Query v5 failed'})}
  });
}
