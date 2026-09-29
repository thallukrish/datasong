import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';
import { entryCandidates, lookaheadFromEntry } from '../semantics/code/queryDrivenSemanticFrontier.js';
import { ensureLocalCodeSemantics, codeSemanticForState } from '../semantics/code/localSemanticLearner.js';

export const NAV_MIN = 0.5;
export const NAV_MAX_DROP = 0.2;
export const FULFILLED = 1.0;
const MAX_STEPS = 64;
const ENTRY_BATCH_SIZE = 20;

const SCORE_SYSTEM = `Score supplied code candidates ONLY against the single active ordered query-plan step. Candidate semantics may be absent for not-yet-learned nodes; in that case use structural name, signature, source location and path only to estimate navigation. For each candidate return navigation confidence n, meaning continuing through this candidate is likely to lead to the needed implementation, and fulfillment f, meaning THIS candidate itself contains enough learned implementation context to satisfy the active step. NEVER return f=1.0 when candidate semantics are absent. f=1.0 is a hard completion signal and must be used only when supplied learned semantics are sufficient for the active step. Return {"c":[{"i":0,"n":0.0,"f":0.0}],"r":[candidateIndex]}.`;
const LOCALIZE_SYSTEM = `For one fulfilled query-plan step, identify exact source line ranges from ONLY the supplied selected function/AST-region evidence. Return {"ranges":[{"symbolId":"","startLine":0,"endLine":0,"why":""}]}.`;
const PLAN_SYSTEM = `Translate a software issue into a short ORDERED CODE INVESTIGATION PLAN using the supplied repository context and deterministic entry-flow previews.  Each step must describe implementation behavior that must be located or explained in source code. Keep only steps that help diagnose or implement the issue. Do not use database language such as rows, grain, dimensions, measures, joins, or entities. Return {"intent":"short diagnosis goal","steps":[{"action":"what code behavior must be established","requires":["code concept or behavior"],"relation":"optional relationship to establish"}]}. Prefer 3-6 steps.`;

async function deriveCodePlan({question,repositoryContext,client,model,usage,log}) {
  const call=await modelJson(client,model,PLAN_SYSTEM,{question,repositoryContext});addUsage(usage,call.usage);
  const steps=arr(call.parsed?.steps).slice(0,8).map(x=>({action:text(x?.action,220),requires:arr(x?.requires).map(v=>text(v,100)).filter(Boolean).slice(0,8),relation:text(x?.relation,180)})).filter(x=>x.action);
  const logicalRequest={baseIntent:text(call.parsed?.intent,220),intent:text(call.parsed?.intent,220),steps};
  log('query_v5_plan',{question,logicalRequest,usage:call.usage,cumulativeUsage:{...usage}});
  return logicalRequest;
}

function activeStepOf(unresolved) { return [...unresolved].sort((a,b)=>a-b)[0]; }
function scoreOf(item, unresolved) {
  const active=activeStepOf(unresolved);
  if(active===undefined)return 0;
  const hit=arr(item?.scores).find(s=>Number(s.step)===active);
  return Number(hit?.navigation||0);
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
function children(state, explorer, flowChildren=null) {
  const symbol=explorer.topology?.symbolById?.get(state.symbolId);
  if(!symbol)return [];
  if(state.type==='code_symbol'){
    const allowed=flowChildren?.get?.(state.symbolId)||null;
    const calls=directCallStates(symbol,state,explorer.topology.symbolById).filter(s=>!allowed||allowed.has(s.symbolId));
    return [...calls,...regionStates(symbol)];
  }
  if(state.type==='code_region') { const allowed=flowChildren?.get?.(state.symbolId)||null; const calls=directCallStates(symbol,state,explorer.topology.symbolById).filter(s=>!allowed||allowed.has(s.symbolId)); return [...calls,...regionStates(symbol,state.regionId)]; }
  return [];
}
async function scoreCandidates({logicalRequest,unresolved,path,candidates,explorer,client,model,usage,log,step,onProgress=()=>{}}) {
  const activeStep=activeStepOf(unresolved);
  if(activeStep===undefined)return[];
  const planStep=logicalRequest.steps[activeStep];
  const payload={activeStep:[activeStep,planStep?.action||'',arr(planStep?.requires),planStep?.relation||''],path:path.map(x=>x.name),candidates:candidates.map((x,i)=>[i,x.name,x.type,x.sourcePath,x.startLine,x.endLine,codeSemanticForState(x,explorer)||null,(explorer.topology?.symbolById?.get(x.symbolId)?.signature||'')])};
  const call=await modelJson(client,model,SCORE_SYSTEM,payload);addUsage(usage,call.usage);
  const byIndex=new Map(candidates.map((x,i)=>[String(i),x])), rejected=new Set(arr(call.parsed?.r).map(String)), out=[];
  for(const row of arr(call.parsed?.c)){const state=byIndex.get(String(row?.i));if(!state||rejected.has(String(row?.i)))continue;out.push({state,scores:[{step:activeStep,navigation:Number(row?.n||0),fulfillment:Number(row?.f||0)}]})}
  log('query_v5_score',{step,payload,result:out,usage:call.usage});onProgress({action:'SCORE',step,activePlanStep:activeStepOf(unresolved),path:path.map(x=>x.name),candidates:out.map(x=>({id:x.state.id,name:x.state.name,scores:x.scores}))});return out;
}
function recordFulfillment(scored, fulfilled, unresolved) {
  const active=activeStepOf(unresolved);if(active===undefined)return;
  for(const item of scored)for(const s of item.scores)if(Number(s.step)===active&&Number(s.fulfillment)>=FULFILLED){if(!fulfilled.has(active))fulfilled.set(active,[]);if(!fulfilled.get(active).some(x=>x.id===item.state.id))fulfilled.get(active).push(item.state)}
}
function unresolvedSteps(count,fulfilled){return new Set(Array.from({length:count},(_,i)=>i).filter(i=>!fulfilled.has(i)))}

export async function runCodeFlowQueryV5({question,repoUrl,explorer,client,model,log=()=>{},onProgress=()=>{}}){
  const usage={prompt:0,completion:0,total:0}, events=[], fulfilled=new Map(); let step=0;
  const wanted=String(repoUrl||explorer.state?.repoUrl||'').trim();if(!wanted)throw new Error('Select a repository before querying code.');
  if(!explorer.topology?.callPathIndex||String(explorer.state?.repoUrl||'').trim()!==wanted){const expected=String(explorer.state?.commit||'').trim(),p=await explorer.topology.prepare(wanted),prepared=String(p?.commit||explorer.topology?.commit||'').trim();if(expected&&prepared&&expected!==prepared)throw new Error('Selected semantic map revision does not match the repository revision prepared for Query v5.');explorer.state.repoUrl=wanted;explorer.state.commit=prepared;explorer.state.runtimeHydration={status:'ready',repoUrl:wanted,commit:prepared};}
  const grouped=explorer.topology?.topCallPaths?.(Number.MAX_SAFE_INTEGER)||[];
  if(!grouped.length)throw new Error('Prepared call-path index contains no code-flow paths.');
  const entryPreview=entryCandidates(grouped,explorer.topology?.symbolById||new Map()).slice(0,12).map(entry=>lookaheadFromEntry(grouped,explorer.topology?.symbolById||new Map(),entry.symbolId,3)).filter(Boolean);
  const repositoryContext={readme:text(explorer.topology?.repositoryReadme||'',5000),entryFlows:entryPreview};
  const logicalRequest=await deriveCodePlan({question,repositoryContext,client,model,usage,log});onProgress({action:'PLAN',plan:logicalRequest.steps,activePlanStep:0});
  explorer.state.semanticProfile='code';
  const flowChildren=new Map();
  for(const g of grouped)for(const v of [g,...arr(g?.alternatives)]){const ids=arr(v?.symbolIds);for(let i=0;i<ids.length-1;i++){if(!flowChildren.has(ids[i]))flowChildren.set(ids[i],new Set());flowChildren.get(ids[i]).add(ids[i+1]);}}
  const rankedEntries=entryCandidates(grouped,explorer.topology?.symbolById||new Map());
  const entries=rankedEntries.map(e=>explorer.topology.symbolById.get(e.symbolId)).filter(Boolean).map(e=>symbolState(e));
  if(!entries.length)throw new Error('Prepared call-path index contains no entry roots.');
  const visited=new Set(), entryTriedByStep=new Map(), stack=[];
  const markVisited=(state)=>{visited.add(state.id);};
  let unresolved=unresolvedSteps(logicalRequest.steps.length,fulfilled);
  const seed=async()=>{
    const activeStep=activeStepOf(unresolved);if(activeStep===undefined)return true;
    if(!entryTriedByStep.has(activeStep))entryTriedByStep.set(activeStep,new Set());
    const tried=entryTriedByStep.get(activeStep);
    const remaining=entries.filter(x=>!visited.has(x.id)&&!tried.has(x.id));if(!remaining.length)return false;
    for(let offset=0;offset<remaining.length;offset+=ENTRY_BATCH_SIZE){
      const candidates=remaining.slice(offset,offset+ENTRY_BATCH_SIZE);
      for(const candidate of candidates)tried.add(candidate.id);
      const scored=await scoreCandidates({logicalRequest,unresolved,path:[],candidates,explorer,client,model,usage,log,step:++step,onProgress});
      const before=new Set(unresolved);recordFulfillment(scored,fulfilled,unresolved);unresolved=unresolvedSteps(logicalRequest.steps.length,fulfilled);
      scored.sort((a,b)=>scoreOf(b,unresolved)-scoreOf(a,unresolved));
      const warm=scored.filter(x=>scoreOf(x,unresolved)>=NAV_MIN||fulfilledNow(x,before));
      const batchEvent={step,action:'ENTRY_BATCH',batch:Math.floor(offset/ENTRY_BATCH_SIZE)+1,start:offset,count:candidates.length,bestNavigation:scored.length?scoreOf(scored[0],unresolved):0,activePlanStep:activeStepOf(unresolved)};
      events.push(batchEvent);onProgress(batchEvent);
      if(!warm.length){if(!unresolved.size)return true;continue}
      stack.push({path:[],current:warm[0],alternatives:warm.slice(1),parentScore:null});
      const event={step,action:'RESEED',state:warm[0].state.name,activePlanStep:activeStepOf(unresolved)};events.push(event);onProgress({...event,path:[warm[0].state.name]});return true;
    }
    return unresolved.size===0;
  };
  const seeded=await seed();
  if(!seeded&&unresolved.size)return {answer:'No entry point had adequate signal for the query plan.',logicalRequest,fulfilled:[],events,usage};
  while(stack.length&&step<MAX_STEPS&&unresolved.size){
    const frame=stack.at(-1), current=frame.current, state=current.state, nav=scoreOf(current,unresolved);markVisited(state);
    await ensureLocalCodeSemantics({states:[state],path:frame.path,explorer,client,model,usage,log,onProgress});
    const rescored=await scoreCandidates({logicalRequest,unresolved,path:frame.path,candidates:[state],explorer,client,model,usage,log,step:++step,onProgress});
    if(rescored.length)frame.current=rescored[0];
    recordFulfillment(rescored.length?rescored:[current],fulfilled,unresolved);unresolved=unresolvedSteps(logicalRequest.steps.length,fulfilled);if(!unresolved.size)break;
    const next=children(state,explorer,flowChildren).filter(x=>!visited.has(x.id));
    if(next.length){
      const scored=await scoreCandidates({logicalRequest,unresolved,path:[...frame.path,state],candidates:next,explorer,client,model,usage,log,step:++step,onProgress});
      const before=new Set(unresolved);recordFulfillment(scored,fulfilled,unresolved);unresolved=unresolvedSteps(logicalRequest.steps.length,fulfilled);
      scored.sort((a,b)=>scoreOf(b,unresolved)-scoreOf(a,unresolved));const warm=scored.filter(x=>scoreOf(x,unresolved)>=NAV_MIN||fulfilledNow(x,before));
      if(warm.length&&nav-scoreOf(warm[0],unresolved)<=NAV_MAX_DROP){stack.push({path:[...frame.path,state],current:warm[0],alternatives:warm.slice(1),parentScore:nav});{const event={step,action:'DESCEND',from:state.name,to:warm[0].state.name,activePlanStep:activeStepOf(unresolved)};events.push(event);onProgress({...event,path:[...frame.path,state,warm[0].state].map(x=>x.name)});}continue}
    }
    let resumed=false;
    while(stack.length){const top=stack.at(-1);if(top.alternatives.length){top.current=top.alternatives.shift();{const event={step,action:'BACKTRACK',to:top.current.state.name,activePlanStep:activeStepOf(unresolved)};events.push(event);onProgress({...event,path:[...top.path,top.current.state].map(x=>x.name)});}resumed=true;break}stack.pop()}
    if(!resumed){if(!(await seed()))break}
  }
  onProgress({action:'SEARCH_COMPLETE',activePlanStep:activeStepOf(unresolved),unresolved:[...unresolved]});
  const localized=[];
  for(const [planStep,states] of fulfilled){const call=await modelJson(client,model,LOCALIZE_SYSTEM,{step:logicalRequest.steps[planStep],evidence:states.map(s=>({id:s.id,symbolId:s.symbolId,sourcePath:s.sourcePath,startLine:s.startLine,endLine:s.endLine,body:s.body}))});addUsage(usage,call.usage);localized.push({planStep,step:logicalRequest.steps[planStep],states:states.map(s=>s.name),ranges:arr(call.parsed?.ranges)})}
  const complete=unresolved.size===0;
  const stepResults=arr(logicalRequest.steps).map((planStep,index)=>({index,step:planStep,fulfilled:localized.find(x=>x.planStep===index)||null}));
  const answer=stepResults.map(x=>x.fulfilled
    ? ('Step '+(x.index+1)+': '+(x.step.action||x.step.requires||'plan step')+'\n'+x.fulfilled.ranges.map(r=>(r.symbolId||x.fulfilled.states.join(', '))+' '+r.startLine+'-'+r.endLine+(r.why?' — '+r.why:'')).join('\n'))
    : ('Step '+(x.index+1)+': unresolved — '+(x.step.action||x.step.requires||'plan step'))).join('\n\n');
  log('query_v5_complete',{complete,unresolved:[...unresolved],fulfilled:localized,events,usage});
  return{answer,logicalRequest,complete,unresolved:[...unresolved],fulfilled:localized,events,investigation:{mode:'code-flow-dfs-v5',usage}};
}