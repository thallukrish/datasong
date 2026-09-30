import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';
import { entryCandidates } from '../semantics/code/queryDrivenSemanticFrontier.js';
import { ensureLocalSemanticWindow, collectLocalSemanticWindow, codeSemanticForState } from '../semantics/code/localSemanticLearner.js';

export const NAV_MIN = 0.5;
export const NAV_MAX_DROP = 0.2;
const MAX_STEPS = 64;
const ENTRY_BATCH_SIZE = 20;
const WINDOW_DEPTH = 3;

const DECIDE_SYSTEM = `Investigate the supplied software issue from learned code semantics only. The original issue never changes. h is the current evidence-backed hypothesis. Set x=1 only when the supplied semantic evidence directly explains the causal mechanism of the issue; then h must be the concise explanation and exploration stops. Otherwise set x=0, update h to the best hypothesis supported by current evidence, and choose at most 3 candidate branches worth exploring next. p is [[candidateIndex,navigationConfidence]]. e is optional and contains candidate indexes whose windows support x=1 when there is no current position. Do not invent missing evidence. Return {"x":0,"h":"","p":[[0,0.0]],"e":[]}. `;
const LOCALIZE_SYSTEM = `Given an issue, its evidence-backed explanation, and raw source evidence selected by LeMap, identify only the exact source ranges that materially support that explanation. Return {"ranges":[{"ref":0,"startLine":0,"endLine":0,"why":""}]}. Use only supplied evidence refs.`;

function symbolState(symbol, parent=null) {
  return { id:symbol.id, type:'code_symbol', name:symbol.name, symbolId:symbol.id, sourcePath:symbol.sourcePath||'', startLine:symbol.startLine||0, endLine:symbol.endLine||0, body:String(symbol.body||''), parent, parentSymbolId:parent };
}

function directCallStates(symbol,state,symbolById){
  const region = state?.type==='code_region' ? {start:Number(state.startLine||0),end:Number(state.endLine||0)} : null;
  return arr(symbol?.references)
    .filter(r=>r.relation==='calls'&&r.targetSymbolId&&(!region||((Number(r.line||r.startLine||0)>=region.start)&&(Number(r.line||r.startLine||0)<=region.end))))
    .map(r=>symbolById?.get?.(r.targetSymbolId))
    .filter(Boolean)
    .map(s=>symbolState(s,symbol.id));
}

function callChildren(state, explorer, flowChildren=null) {
  const symbol=explorer.topology?.symbolById?.get(state.symbolId);
  if(!symbol)return [];
  const allowed=flowChildren?.get?.(state.symbolId)||null;
  return directCallStates(symbol,state,explorer.topology.symbolById).filter(s=>!allowed||allowed.has(s.symbolId));
}

function semanticNodeView(state,explorer){
  const semantic=codeSemanticForState(state,explorer)||{};
  return [state.name,text(semantic.purpose||'',260),text(semantic.effect||'',220)];
}

function semanticWindowView(rootState,window,explorer){
  const stateById=new Map(arr(window?.states).map(state=>[state.id,state]));
  const childrenById=new Map();
  for(const link of arr(window?.links)){
    if(!childrenById.has(link.from))childrenById.set(link.from,[]);
    childrenById.get(link.from).push(link.to);
  }
  const visit=(id,seen=new Set())=>{
    const state=stateById.get(id);if(!state)return null;
    const nextSeen=new Set(seen);nextSeen.add(id);
    const children=arr(childrenById.get(id))
      .filter(childId=>!nextSeen.has(childId))
      .map(childId=>visit(childId,nextSeen))
      .filter(Boolean);
    return [...semanticNodeView(state,explorer),children];
  };
  return visit(rootState.id)||[...semanticNodeView(rootState,explorer),[]];
}

function dedupeStates(states=[]){
  const seen=new Set(),out=[];
  for(const state of arr(states)){if(!state?.id||seen.has(state.id))continue;seen.add(state.id);out.push(state)}
  return out;
}

async function decide({
  question,hypothesis='',path=[],currentState=null,currentWindow=null,
  candidates=[],candidateWindows=[],explorer,client,model,usage,log,step,onProgress=()=>{}
}) {
  const payload={
    q:question,
    h:hypothesis||'',
    e:path.map(state=>semanticNodeView(state,explorer)),
    w:currentState&&currentWindow?semanticWindowView(currentState,currentWindow,explorer):null,
    c:candidates.map((state,index)=>[index,semanticWindowView(state,candidateWindows[index],explorer)])
  };
  const call=await modelJson(client,model,DECIDE_SYSTEM,payload);addUsage(usage,call.usage);
  const byIndex=new Map(candidates.map((state,index)=>[String(index),state]));
  const picks=[];
  for(const row of arr(call.parsed?.p)){
    const state=byIndex.get(String(row?.[0]));if(!state)continue;
    picks.push({state,score:Number(row?.[1]||0)});
  }
  picks.sort((a,b)=>b.score-a.score);
  const result={
    explained:Number(call.parsed?.x||0)===1,
    hypothesis:text(call.parsed?.h||hypothesis||'',900),
    picks,
    evidenceIndexes:arr(call.parsed?.e).map(Number).filter(Number.isInteger)
  };
  log('query_v5_decision',{step,payload,modelResponse:call.parsed,result:{explained:result.explained,hypothesis:result.hypothesis,picks:picks.map(x=>({name:x.state.name,score:x.score})),evidenceIndexes:result.evidenceIndexes},usage:call.usage});
  onProgress({action:'DECIDE',step,hypothesis:result.hypothesis,explained:result.explained,path:path.map(x=>x.name),candidates:picks.map(x=>({id:x.state.id,name:x.state.name,navigation:x.score}))});
  return result;
}

async function localizeExplanation({question,explanation,evidenceStates,client,model,usage,log}){
  const states=dedupeStates(evidenceStates);
  const evidence=states.map((state,ref)=>({
    ref,
    name:state.name,
    symbolId:state.symbolId,
    sourcePath:state.sourcePath,
    startLine:state.startLine,
    endLine:state.endLine,
    body:text(state.body,3200)
  }));
  const call=await modelJson(client,model,LOCALIZE_SYSTEM,{issue:question,explanation,evidence});addUsage(usage,call.usage);
  const ranges=[];
  for(const item of arr(call.parsed?.ranges)){
    const source=evidence[Number(item?.ref)];if(!source)continue;
    ranges.push({
      symbolId:source.symbolId,
      name:source.name,
      sourcePath:source.sourcePath,
      startLine:Number(item?.startLine||source.startLine||0),
      endLine:Number(item?.endLine||source.endLine||0),
      why:text(item?.why||'',260)
    });
  }
  log('query_v5_localize',{explanation,ranges,usage:call.usage});
  return ranges;
}

export async function runCodeFlowQueryV5({question,repoUrl,explorer,client,model,log=()=>{},onProgress=()=>{}}){
  const usage={prompt:0,completion:0,total:0},events=[];let step=0;
  const wanted=String(repoUrl||explorer.state?.repoUrl||'').trim();
  if(!wanted)throw new Error('Select a repository before querying code.');

  if(!explorer.topology?.callPathIndex||String(explorer.state?.repoUrl||'').trim()!==wanted){
    const expected=String(explorer.state?.commit||'').trim();
    const preparedResult=await explorer.topology.prepare(wanted);
    const prepared=String(preparedResult?.commit||explorer.topology?.commit||'').trim();
    if(expected&&prepared&&expected!==prepared)throw new Error('Selected semantic map revision does not match the repository revision prepared for Query v5.');
    explorer.state.repoUrl=wanted;
    explorer.state.commit=prepared;
    explorer.state.runtimeHydration={status:'ready',repoUrl:wanted,commit:prepared};
  }

  const grouped=explorer.topology?.topCallPaths?.(Number.MAX_SAFE_INTEGER)||[];
  if(!grouped.length)throw new Error('Prepared call-path index contains no code-flow paths.');
  explorer.state.semanticProfile='code';

  const flowChildren=new Map();
  for(const group of grouped)for(const variant of [group,...arr(group?.alternatives)]){
    const ids=arr(variant?.symbolIds);
    for(let i=0;i<ids.length-1;i++){
      if(!flowChildren.has(ids[i]))flowChildren.set(ids[i],new Set());
      flowChildren.get(ids[i]).add(ids[i+1]);
    }
  }

  const rankedEntries=entryCandidates(grouped,explorer.topology?.symbolById||new Map());
  const entries=rankedEntries.map(entry=>explorer.topology.symbolById.get(entry.symbolId)).filter(Boolean).map(symbol=>symbolState(symbol));
  if(!entries.length)throw new Error('Prepared call-path index contains no entry roots.');

  const visited=new Set(),entryTried=new Set(),stack=[];
  let finalExplanation='',finalEvidence=[];

  const seed=async()=>{
    const remaining=entries.filter(state=>!visited.has(state.id)&&!entryTried.has(state.id));
    if(!remaining.length)return false;

    for(let offset=0;offset<remaining.length;offset+=ENTRY_BATCH_SIZE){
      const candidates=remaining.slice(offset,offset+ENTRY_BATCH_SIZE);
      for(const candidate of candidates)entryTried.add(candidate.id);

      const windows=[];
      for(const candidate of candidates){
        const learned=await ensureLocalSemanticWindow({state:candidate,path:[],depth:WINDOW_DEPTH,explorer,client,model,usage,log,onProgress});
        windows.push(learned.window);
      }

      const decision=await decide({question,hypothesis:'',path:[],candidates,candidateWindows:windows,explorer,client,model,usage,log,step:++step,onProgress});
      const batchEvent={step,action:'ENTRY_BATCH',batch:Math.floor(offset/ENTRY_BATCH_SIZE)+1,start:offset,count:candidates.length,bestNavigation:decision.picks[0]?.score||0,hypothesis:decision.hypothesis,explained:decision.explained};
      events.push(batchEvent);onProgress(batchEvent);

      if(decision.explained){
        const indexes=decision.evidenceIndexes.length?decision.evidenceIndexes:(decision.picks.length?[candidates.indexOf(decision.picks[0].state)]:[0]);
        finalExplanation=decision.hypothesis;
        finalEvidence=dedupeStates(indexes.flatMap(index=>arr(windows[index]?.states)));
        return true;
      }

      const warm=decision.picks.filter(item=>item.score>=NAV_MIN);
      if(!warm.length)continue;

      stack.push({path:[],current:warm[0],alternatives:warm.slice(1),hypothesis:decision.hypothesis});
      const event={step,action:'RESEED',state:warm[0].state.name,hypothesis:decision.hypothesis};
      events.push(event);onProgress({...event,path:[warm[0].state.name]});
      return true;
    }
    return false;
  };

  const seeded=await seed();
  if(!seeded)return {answer:'No learned entry flow had adequate evidence for this issue.',complete:false,explained:false,hypothesis:'',events,usage};

  while(!finalExplanation&&stack.length&&step<MAX_STEPS){
    const frame=stack.at(-1),state=frame.current.state;
    visited.add(state.id);

    const learned=await ensureLocalSemanticWindow({state,path:frame.path,depth:WINDOW_DEPTH,explorer,client,model,usage,log,onProgress});
    const path=[...frame.path,state];
    const next=callChildren(state,explorer,flowChildren).filter(child=>!visited.has(child.id));
    const candidateWindows=next.map(child=>collectLocalSemanticWindow({state:child,explorer,depth:Math.max(0,WINDOW_DEPTH-1)}));

    const decision=await decide({
      question,
      hypothesis:frame.hypothesis,
      path,
      currentState:state,
      currentWindow:learned.window,
      candidates:next,
      candidateWindows,
      explorer,client,model,usage,log,step:++step,onProgress
    });

    if(decision.explained){
      finalExplanation=decision.hypothesis;
      finalEvidence=dedupeStates([...path,...arr(learned.window?.states)]);
      break;
    }

    const warm=decision.picks.filter(item=>item.score>=NAV_MIN);
    if(warm.length&&frame.current.score-warm[0].score<=NAV_MAX_DROP){
      stack.push({path,current:warm[0],alternatives:warm.slice(1),hypothesis:decision.hypothesis});
      const event={step,action:'DESCEND',from:state.name,to:warm[0].state.name,hypothesis:decision.hypothesis};
      events.push(event);onProgress({...event,path:[...path,warm[0].state].map(x=>x.name)});
      continue;
    }

    let resumed=false;
    while(stack.length){
      const top=stack.at(-1);
      if(top.alternatives.length){
        top.current=top.alternatives.shift();
        const event={step,action:'BACKTRACK',to:top.current.state.name,hypothesis:top.hypothesis};
        events.push(event);onProgress({...event,path:[...top.path,top.current.state].map(x=>x.name)});
        resumed=true;
        break;
      }
      stack.pop();
    }
    if(!resumed){
      if(!(await seed()))break;
    }
  }

  if(!finalExplanation){
    onProgress({action:'SEARCH_COMPLETE',explained:false,hypothesis:stack.at(-1)?.hypothesis||''});
    log('query_v5_complete',{complete:false,explained:false,hypothesis:stack.at(-1)?.hypothesis||'',events,usage});
    return {answer:'The explored semantic evidence did not yet explain the issue.',complete:false,explained:false,hypothesis:stack.at(-1)?.hypothesis||'',events,usage,investigation:{mode:'code-flow-hypothesis-v5',usage}};
  }

  onProgress({action:'EXPLAINED',explained:true,hypothesis:finalExplanation});
  const ranges=await localizeExplanation({question,explanation:finalExplanation,evidenceStates:finalEvidence,client,model,usage,log});
  const locations=ranges.map(range=>`${range.sourcePath}#${range.name} ${range.startLine}-${range.endLine}${range.why?' — '+range.why:''}`).join('\n');
  const answer=finalExplanation+(locations?'\n\n'+locations:'');
  log('query_v5_complete',{complete:true,explained:true,hypothesis:finalExplanation,ranges,events,usage});
  return {answer,complete:true,explained:true,hypothesis:finalExplanation,ranges,events,usage,investigation:{mode:'code-flow-hypothesis-v5',usage}};
}
