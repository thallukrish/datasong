import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';
import { mergeBranchSemantics } from '../semantics/code/queryDrivenSemanticFrontier.js';

const SCORE = `Select up to 3 deterministic code entries relevant to the question. Return {"entries":[{"index":0,"score":0.0}]}.`;
const LEARN = `Learn local code semantics only. Do not answer the question or assign relevance. Use exact supplied IDs. Return {"symbols":[{"symbolId":"","purpose":"","effect":""}],"branches":[{"fromSymbolId":"","toSymbolId":"","purpose":"","effect":"","evidenceSourcePath":"","evidenceStartLine":0,"evidenceEndLine":0}]}.`;
const ANSWER = `Answer only from supplied deterministic code evidence and learned local semantics. State uncertainty. Return {"answer":"","evidence":[{"symbolId":"","why":""}],"nextStep":""}.`;

function flat(root){const nodes=[],edges=[];const walk=n=>{if(!n?.symbolId)return;nodes.push(n);for(const c of arr(n.children)){edges.push([n.symbolId,c.symbolId]);walk(c)}};walk(root);return{nodes,edges}}
function view(s){return{symbolId:s?.id||s?.symbolId||'',name:s?.name||'',signature:s?.signature||'',sourcePath:s?.sourcePath||'',startLine:Number(s?.startLine||0),endLine:Number(s?.endLine||0)}}
function mergeSymbols(old={},items=[]){const out={...old};for(const x of arr(items)){const id=String(x?.symbolId||''),purpose=text(x?.purpose,600);if(id&&purpose)out[id]={symbolId:id,purpose,effect:text(x?.effect,500)}}return out}

export async function runQueryDrivenCodeFlow({question,repoUrl,explorer,client,model,log=()=>{}}){
  const usage={prompt:0,completion:0,total:0}, wanted=String(repoUrl||explorer.state?.repoUrl||'').trim();
  if(!wanted)throw new Error('Select a repository before querying code.');
  if(!explorer.topology?.callPathIndex||String(explorer.state?.repoUrl||'').trim()!==wanted){
    const p=await explorer.topology.prepare(wanted);
    explorer.state.repoUrl=wanted; explorer.state.commit=String(p?.commit||explorer.topology?.commit||'');
    explorer.state.semanticProfile='code'; explorer.state.status='complete';
    explorer.state.runtimeHydration={status:'ready',repoUrl:wanted,commit:explorer.state.commit};
    explorer._mapRestoreAttempted=true; explorer._mapRestored=false;
    log('code_query_topology_prepared',{repoUrl:wanted,commit:explorer.state.commit,groupedPathCount:Number(p?.callPathIndex?.groupedPathCount||0)});
  }
  const entries=explorer.codeSemanticEntryCandidates?.()||[];
  if(!entries.length)throw new Error('No deterministic entry-rooted call paths were found.');
  const candidates=entries.slice(0,40).map((e,index)=>{const f=flat(explorer.codeSemanticLookahead?.(e.symbolId,2));return{index,...view(explorer.topology.symbolById.get(e.symbolId)||e),calls:f.nodes.slice(1,12).map(n=>n.name)}});
  const scored=await modelJson(client,model,SCORE,{question,entries:candidates},{maxTokens:360});addUsage(usage,scored.usage);
  const selected=arr(scored.parsed?.entries).slice(0,3).map(x=>entries[Number(x?.index)]).filter(Boolean);if(!selected.length)selected.push(entries[0]);
  const learned=[];
  for(const e of selected){
    let preview=explorer.codeSemanticLookahead?.(e.symbolId,3);if(!preview)continue;
    const f=flat(preview), nodes=f.nodes.map(n=>{const s=explorer.topology.symbolById.get(n.symbolId)||n;return{...view(s),body:String(s?.body||'').slice(0,3200)}}), missingNodes=nodes.filter(n=>!explorer.state?.codeSymbolSemantics?.[n.symbolId]), missingEdges=f.edges.filter(([a,b])=>!explorer.state?.codeBranchSemantics?.[`${a}=>${b}`]);
    if(missingNodes.length||missingEdges.length){
      const call=await modelJson(client,model,LEARN,{nodes:missingNodes,edges:missingEdges.map(([fromSymbolId,toSymbolId])=>({fromSymbolId,toSymbolId}))},{maxTokens:1000});addUsage(usage,call.usage);
      explorer.state.codeSymbolSemantics=mergeSymbols(explorer.state.codeSymbolSemantics||{},call.parsed?.symbols||[]);
      explorer.state.codeBranchSemantics=mergeBranchSemantics(explorer.state.codeBranchSemantics||{},call.parsed?.branches||[]);
      log('code_query_semantics_learned',{entrySymbolId:e.symbolId,symbols:arr(call.parsed?.symbols).length,branches:arr(call.parsed?.branches).length,usage:call.usage});
    }else log('code_query_semantics_reused',{entrySymbolId:e.symbolId});
    preview=explorer.codeSemanticLookahead?.(e.symbolId,3);learned.push(preview);
  }
  explorer.persistSemanticMap?.();
  const evidence=learned.map(p=>{const f=flat(p);return{entrySymbolId:p.symbolId,symbols:f.nodes.map(n=>({...view(explorer.topology.symbolById.get(n.symbolId)||n),semantic:explorer.state.codeSymbolSemantics?.[n.symbolId]||null})),branches:f.edges.map(([a,b])=>({fromSymbolId:a,toSymbolId:b,semantic:explorer.state.codeBranchSemantics?.[`${a}=>${b}`]||null}))}});
  const answer=await modelJson(client,model,ANSWER,{question,frontiers:evidence},{maxTokens:900});addUsage(usage,answer.usage);
  log('code_query_complete',{entrySymbolIds:learned.map(x=>x.symbolId),usage});
  return{answer:text(answer.parsed?.answer,4000),evidence:arr(answer.parsed?.evidence),nextStep:text(answer.parsed?.nextStep,500),frontiers:evidence,investigation:{usage}};
}
