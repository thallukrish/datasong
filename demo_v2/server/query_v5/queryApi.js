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
      const progress={running:true,question,plan:[],activePlanStep:0,action:'START',path:[],candidates:[],learnNodes:[]};explorer.state.queryV5Progress=progress;explorer.emit?.();
      const onProgress=(event={})=>{const p=explorer.state.queryV5Progress||progress;if(event.action==='PLAN')p.plan=event.plan||[];if(Number.isInteger(event.activePlanStep))p.activePlanStep=event.activePlanStep;if(Array.isArray(event.path))p.path=event.path;if(event.action==='SCORE')p.candidates=event.candidates||[];if(event.action==='LEARN_START')p.learnNodes=event.nodes||[];if(event.action==='LEARN_DONE')p.learnNodes=[];p.action=event.action||p.action;p.detail=event;explorer.state.queryV5Progress=p;explorer.emit?.();};
      const result=await runCodeFlowQueryV5({question,repoUrl:String(req.body?.repoUrl||explorer.state?.repoUrl||''),explorer,client:queryClient,model:queryModel,log,onProgress});
      explorer.state.queryV5Progress={...(explorer.state.queryV5Progress||progress),running:false,action:'DONE'};explorer.emit?.();
      return res.json(result);
    }catch(error){if(explorer.state)explorer.state.queryV5Progress={...(explorer.state.queryV5Progress||{}),running:false,action:'ERROR',error:error.message||String(error)};explorer.emit?.();log('query_v5_error',{error:error.message||String(error)});return res.status(500).json({error:error.message||'Query v5 failed'})}
  });
}
