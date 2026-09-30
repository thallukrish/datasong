import fs from 'node:fs';
import readline from 'node:readline';

const inputPath=process.argv[2];
const outputPath=process.argv[3]||'swe-explore-results.jsonl';
const baseUrl=String(process.env.LEMAP_URL||'http://localhost:3102').replace(/\/$/,'');
if(!inputPath){
  console.error('Usage: node scripts/swe-explore-runner.js <cases.jsonl> [results.jsonl]');
  process.exit(2);
}

async function postQuery(row){
  const response=await fetch(baseUrl+'/api/query-map-v5',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      question:String(row.problem_statement||row.issue||''),
      repoUrl:String(row.repo_url||row.repoUrl||''),
      repoCommit:String(row.repo_commit||row.base_commit||'')
    })
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||('HTTP '+response.status));
  return body;
}

const stream=fs.createReadStream(inputPath,'utf8');
const rl=readline.createInterface({input:stream,crlfDelay:Infinity});
for await(const line of rl){
  const raw=line.trim();if(!raw)continue;
  const row=JSON.parse(raw);
  const startedAt=new Date().toISOString();
  try{
    const result=await postQuery(row);
    const out={
      instance_id:row.instance_id||'',
      repo_url:row.repo_url||row.repoUrl||'',
      repo_commit:row.repo_commit||row.base_commit||'',
      started_at:startedAt,
      finished_at:new Date().toISOString(),
      complete:!!result.complete,
      explained:!!result.explained,
      mode:result.mode||'',
      hypothesis:result.hypothesis||'',
      regions:result.sweExplore?.regions||[],
      diagnostics:result.diagnostics||{},
      usage:result.usage||{}
    };
    fs.appendFileSync(outputPath,JSON.stringify(out)+'\n','utf8');
    console.log('[swe-explore]',out.instance_id,'complete='+out.complete,'regions='+out.regions.length,'steps='+(out.diagnostics.decisionSteps??'?'),'tokens='+(out.diagnostics.llmTokens?.total??'?'));
  }catch(error){
    const out={instance_id:row.instance_id||'',repo_url:row.repo_url||row.repoUrl||'',repo_commit:row.repo_commit||row.base_commit||'',started_at:startedAt,finished_at:new Date().toISOString(),error:error.message||String(error)};
    fs.appendFileSync(outputPath,JSON.stringify(out)+'\n','utf8');
    console.error('[swe-explore]',out.instance_id,'ERROR',out.error);
  }
}
