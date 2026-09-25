import fs from 'node:fs';
import path from 'node:path';
import { arr, key, text } from '../query_v2/modelJson.js';

function tokens(value) {
  return new Set(String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(v => v.length > 2));
}
function overlap(a,b) {
  const aa=tokens(a), bb=tokens(b);
  if (!aa.size || !bb.size) return 0;
  let hit=0; for (const v of aa) if (bb.has(v)) hit += 1;
  return hit / Math.max(aa.size, bb.size);
}

export function createCausalFragmentStore(dataRoot) {
  const dir=path.join(dataRoot,'query-runs-v5');
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'causal-fragments.json');
  const load=()=>{ try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return []; } };
  const save=(items)=>fs.writeFileSync(file,JSON.stringify(items,null,2),'utf8');

  const upsertFromInvestigation=(record)=>{
    const items=load();
    const nodes=new Map(arr(record?.causalGraph?.nodes).map(n=>[n.id,n]));
    for(const edge of arr(record?.causalGraph?.edges)){
      if(!['workflow_supported','entity_connected'].includes(edge.status)) continue;
      const from=text(nodes.get(edge.from)?.label,180), to=text(nodes.get(edge.to)?.label,180);
      if(!from||!to||!arr(edge.workflowEvidence).length) continue;
      const fingerprint=key(`${from}|${to}|${edge.hypothesis}`);
      const fragment={
        version:1,fingerprint,from,to,hypothesis:text(edge.hypothesis,260),
        workflowEvidence:arr(edge.workflowEvidence),
        entityEvidence:arr(edge.entityEvidence),
        repoUrl:record.repoUrl||'',commit:record.commit||'',sourceInvestigationId:record.id,
        confidence:Math.max(...arr(edge.workflowEvidence).map(w=>Number(w.confidence||0)),0),
        updatedAt:new Date().toISOString()
      };
      const i=items.findIndex(x=>x.fingerprint===fingerprint&&x.repoUrl===fragment.repoUrl);
      if(i>=0) items[i]=fragment; else items.push(fragment);
    }
    save(items.slice(-500));
  };

  const match=(edge,nodesById,repoUrl)=>{
    const from=nodesById.get(edge.from)?.label||'', to=nodesById.get(edge.to)?.label||'';
    return load().filter(f=>!repoUrl||f.repoUrl===repoUrl).map(f=>({
      ...f,
      reuseScore:(overlap(from,f.from)+overlap(to,f.to)+overlap(edge.hypothesis,f.hypothesis))/3
    })).filter(f=>f.reuseScore>=0.6).sort((a,b)=>b.reuseScore-a.reuseScore).slice(0,3);
  };
  return { load, match, upsertFromInvestigation };
}
