import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';
import { deriveDimensions } from '../query_v4/scorer.js';
import { ensureLocalCodeSemantics, codeSemanticForState } from '../semantics/code/localSemanticLearner.js';

export const NAV_MIN = 0.5;
export const NAV_MAX_DROP = 0.2;
export const FULFILLED = 1.0;
const MAX_STEPS = 64;

const SCORE_SYSTEM = \`Score supplied code candidates against unresolved ordered query-plan steps. For each candidate and step return TWO independent scores: navigation confidence n means continuing through this candidate is likely to lead to the needed implementation; fulfillment f means THIS candidate itself contains enough implementation context to satisfy the step. f=1.0 is a hard completion signal and must be used only when the supplied source/semantics are sufficient for that step. Return {"c":[{"i":0,"s":[[stepIndex,n,f]]}],"r":[candidateIndex]}.\`;
const LOCALIZE_SYSTEM = \`For one fulfilled query-plan step, identify exact source line ranges from ONLY the supplied selected function/AST-region evidence. Return {"ranges":[{"symbolId":"","startLine":0,"endLine":0,"why":""}]}.\`;

function scoreOf(item, unresolved) {
  let best=0;
  for(const s of arr(item?.scores)) if(unresolved.has(Number(s.step))) best=Math.max(best,Number(s.navigation||0));
  return best;
}
function fulfilledNow(item, unresolved){
  return arr(item?.scores).some(s=>unresolved.has(Number(s.step))&&Number(s.fulfillment)>=FULFILLED);
}
function symbolState(symbol, parent=null) {
  return { id:symbol.id, type:'code_symbol', name:symbol.name, symbolId:symbol.id, sourcePath:symbol.sourcePath||'', startLine:symbol.startLine||0, endLine:symbol.endLine||0, body:String(symbol.body||''), parent, parentSymbolId:parent };
}
function regionStates(symbol, parentRegionId=null) {
  return arr(symbol?.regions).filter(r=>(r.parentRegionId||null)===(parentRegionId||null)).map(r=>({ id:r.id,type:'code_region',kind:r.kind||'',name:symbol.name+' ['+(r.kind||'region')+' '+r.startLine+'-'+r.endLine+']',symbolId:symbol.id,regionId:r.id,sourcePath:symbol.sourcePath||'',startLine:r.startLine,endLine:r.endLine,body:String(r.body||''),parent:parentRegionId||symbol.id,parentSymbolId:symbol.id }));
}
function directCallStates(symbol,state,symbolById){
  const region = state?.type==='code_region' ? {start:Number(state.startLine||0),end:Number(state.endLine||0)} : null;
  return arr(symbol?.references).filter(r=>r.relation==='calls'&&r.targetSymbolId&&(!region||((Number(r.line||r.startLine||0)>=region.start)&&(Number(r.line||r.startLine||0)<=region.end)))).map(r=>symbolById?.get?.(r.targetSymbolId)).filter(Boolean).map(s=>symbolState(s,symbol.id));
}
function children(state, explorer) {
  const symbol=explorer.topology?.symbolById?.get(state.symbolId);
  if(!symbol)return [];
  if(state.type==='code_symbol'){
    const calls=directCallStates(symbol,state,explorer.topology.symbolById);
    return [...calls,...regionStates(symbol)];
  }
  if(state.type==='code_region') return [...directCallStates(symbol,state,explorer.topology.symbolById),...regionStates(symbol,state.regionId)];
  return [];
}
async function scoreCandidates({logicalRequest,unresolved,path,candidates,explorer,client,model,usage,log,step}) {
  await ensureLocalCodeSemantics({states:candidates,explorer,client,model,usage,log});
  const payload={plan:arr(logicalRequest.steps).map((x,i)=>[i,x.action,x.requires,x.relation]),unresolved:[...unresolved],path:path.map(x=>x.name),candidates:candidates.map((x,i)=>[i,x.name,x.type,x.sourcePath,x.startLine,x.endLine,codeSemanticForState(x,explorer.state)||null])};
  const call=await modelJson(client,model,SCORE_SYSTEM,payload,{maxTokens:700});addUsage(usage,call.usage);
  const byIndex=new Map(candidates.map((x,i)=>[String(i),x])), rejected=new Set(arr(call.parsed?.r).map(String)), out=[];
  for(const row of arr(call.parsed?.c)){const state=byIndex.get(String(row?.i));if(!state||rejected.has(String(row?.i)))continue;out.push({state,scores:arr(row?.s).map(s=>({step:Number(s?.[0]),navigation:Number(s?.[1]||0),fulfillment:Number(s?.[2]||0)}))})}
  log('query_v5_score',{step,payload,result:out,usage:call.usage});return out;
}
function recordFulfillment(scored, fulfilled) {
  for(const item of scored)for(const s of item.scores)if(Number(s.fulfillment)>=FULFILLED){if(!fulfilled.has(s.step))fulfilled.set(s.step,[]);if(!fulfilled.get(s.step).some(x=>x.id===item.state.id))fulfilled.get(s.step).push(item.state)}
}
function unresolvedSteps(count,fulfilled){return new Set(Array.from({length:count},(_,i)=>i).filter(i=>!fulfilled.has(i)))}

export async function runCodeFlowQueryV5({question,repoUrl,explorer,client,model,log=()=>{}}){
  const usage={prompt:0,completion:0,total:0}, events=[], fulfilled=new Map(); let step=0;
  const wanted=String(repoUrl||explorer.state?.repoUrl||'').trim();if(!wanted)throw new Error('Select a repository before querying code.');
  if(!explorer.topology?.callPathIndex||String(explorer.state?.repoUrl||'').trim()!==wanted){const p=await explorer.topology.prepare(wanted);explorer.state.repoUrl=wanted;explorer.state.commit=String(p?.commit||explorer.topology?.commit||'');}
  const logicalRequest=await deriveDimensions({question,client,model,usage,log});
  const entries=arr(explorer.codeSemanticEntryCandidates?.()).map(e=>symbolState(explorer.topology.symbolById.get(e.symbolId)||e));
  if(!entries.length)throw new Error('No deterministic code entry points found.');
  const visited=new Set(), stack=[];
  let unresolved=unresolvedSteps(logicalRequest.steps.length,fulfilled);
  const seed=async()=>{
    const candidates=entries.filter(x=>!visited.has(x.id));if(!candidates.length)return false;
    const scored=await scoreCandidates({logicalRequest,unresolved,path:[],candidates,explorer,client,model,usage,log,step:++step});recordFulfillment(scored,fulfilled);unresolved=unresolvedSteps(logicalRequest.steps.length,fulfilled);
    scored.sort((a,b)=>scoreOf(b,unresolved)-scoreOf(a,unresolved));const warm=scored.filter(x=>scoreOf(x,unresolved)>=NAV_MIN||fulfilledNow(x,unresolved));if(!warm.length)return false;
    for(const item of scored) visited.add(item.state.id);
    stack.push({path:[],current:warm[0],alternatives:warm.slice(1),parentScore:null});events.push({step,action:'RESEED',state:warm[0].state.name});return true;
  };
  if(!(await seed()))return {answer:'No entry point had adequate signal for the query plan.',logicalRequest,fulfilled:[],events,usage};
  while(stack.length&&step<MAX_STEPS&&unresolved.size){
    const frame=stack.at(-1), current=frame.current, state=current.state, nav=scoreOf(current,unresolved);visited.add(state.id);
    recordFulfillment([current],fulfilled);unresolved=unresolvedSteps(logicalRequest.steps.length,fulfilled);if(!unresolved.size)break;
    const next=children(state,explorer).filter(x=>!visited.has(x.id));
    if(next.length){
      const scored=await scoreCandidates({logicalRequest,unresolved,path:[...frame.path,state],candidates:next,explorer,client,model,usage,log,step:++step});recordFulfillment(scored,fulfilled);unresolved=unresolvedSteps(logicalRequest.steps.length,fulfilled);
      scored.sort((a,b)=>scoreOf(b,unresolved)-scoreOf(a,unresolved));const warm=scored.filter(x=>scoreOf(x,unresolved)>=NAV_MIN||fulfilledNow(x,unresolved));
      if(warm.length&&nav-scoreOf(warm[0],unresolved)<=NAV_MAX_DROP){stack.push({path:[...frame.path,state],current:warm[0],alternatives:warm.slice(1),parentScore:nav});events.push({step,action:'DESCEND',from:state.name,to:warm[0].state.name});continue}
    }
    let resumed=false;
    while(stack.length){const top=stack.at(-1);if(top.alternatives.length){top.current=top.alternatives.shift();events.push({step,action:'BACKTRACK',to:top.current.state.name});resumed=true;break}stack.pop()}
    if(!resumed){if(!(await seed()))break}
  }
  const localized=[];
  for(const [planStep,states] of fulfilled){const call=await modelJson(client,model,LOCALIZE_SYSTEM,{step:logicalRequest.steps[planStep],evidence:states.map(s=>({id:s.id,symbolId:s.symbolId,sourcePath:s.sourcePath,startLine:s.startLine,endLine:s.endLine,body:s.body}))},{maxTokens:420});addUsage(usage,call.usage);localized.push({planStep,step:logicalRequest.steps[planStep],states:states.map(s=>s.name),ranges:arr(call.parsed?.ranges)})}
  const complete=unresolved.size===0;log('query_v5_complete',{complete,unresolved:[...unresolved],fulfilled:localized,events,usage});
  return{answer:complete?'All query-plan steps were located in the code flow.':'Code search ended with unresolved query-plan steps.',logicalRequest,complete,unresolved:[...unresolved],fulfilled:localized,events,investigation:{mode:'code-flow-dfs-v5',usage}};
}
