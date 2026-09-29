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
      const result=await runCodeFlowQueryV5({question,repoUrl:String(req.body?.repoUrl||explorer.state?.repoUrl||''),explorer,client:queryClient,model:queryModel,log});
      return res.json(result);
    }catch(error){log('query_v5_error',{error:error.message||String(error)});return res.status(500).json({error:error.message||'Query v5 failed'})}
  });
}
