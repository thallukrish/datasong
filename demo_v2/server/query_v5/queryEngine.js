import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';
import { entryCandidates } from '../semantics/code/queryDrivenSemanticFrontier.js';
import { ensureLocalSemanticWindow, codeSemanticForState } from '../semantics/code/localSemanticLearner.js';

const MAX_STEPS = 64;
const ENTRY_BATCH_SIZE = 20;
const WINDOW_DEPTH = 3;

const CLASSIFY_SYSTEM = `Classify the user's code request into exactly one investigation mode. Use "causal" when the user reports a bug, failure, regression, incorrect behavior, unexpected result, or asks what caused/why something went wrong. Use "query" for descriptive code questions such as how something works, where something is implemented, what happens in a flow, or what code handles something. Return {"mode":"causal"} or {"mode":"query"} only.`;

const CAUSAL_DECIDE_SYSTEM = `Investigate a reported software issue from learned code semantics only. The original issue never changes. f is the cumulative evidence ledger as [factId,status,text]. s contains numbered semantic evidence slots. h is the current branch hypothesis.

Reason causally, not by topical relevance. At every position ask whether the behavior represented by the full traversed path plus supported facts could actually produce the observed issue. Rank candidate continuations by how plausibly they continue that causal chain toward the failure mechanism. Tests, config helpers, validators, or similarly related code should score low or be omitted unless execution through them could itself cause the reported behavior.

Add explicit behavior established by the supplied semantic evidence to a as [factText,[supportSlotIds]]. Do not wait until the final root cause before recording facts. Mark contradicted existing facts in d=[factId] and re-supported disputed facts in r=[factId].

Set x=1 only when the supported ledger facts plus the traversed semantic path establish a coherent causal mechanism that could produce the reported behavior. h must then state that causal mechanism concisely. Otherwise x=0 and h is the current evidence-backed causal hypothesis.

p is [[candidateIndex,causalScore]] for at most 3 continuations, where causalScore means "how likely is following this branch to complete a causal explanation of the reported issue?", not generic relevance. Do not invent missing evidence. Return {"x":0,"h":"","a":[],"d":[],"r":[],"p":[[0,0.0]]}.`;

const QUERY_DECIDE_SYSTEM = `Investigate a code question from learned code semantics only. The original question never changes. f is the cumulative evidence ledger as [factId,status,text]. s contains numbered semantic evidence slots. h is the current answer hypothesis.

At every position ask whether the full traversed path plus supported facts is sufficient to answer the question. Rank candidate continuations by how much following them is likely to complete the answer. Add explicit behavior established by supplied semantic evidence to a as [factText,[supportSlotIds]]. Mark contradicted facts in d=[factId] and re-supported disputed facts in r=[factId].

Set x=1 only when the supported facts plus traversed semantic path directly answer the question. Then h is the concise answer. Otherwise x=0 and h is the current evidence-backed answer hypothesis. p is [[candidateIndex,relevanceScore]] for at most 3 continuations. Do not invent missing evidence. Return {"x":0,"h":"","a":[],"d":[],"r":[],"p":[[0,0.0]]}.`;
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

function ledgerView(ledger){
  return [...ledger.values()].map(fact=>[fact.id,fact.status,fact.text]);
}

function ledgerEvidenceStates(ledger){
  return dedupeStates([...ledger.values()].filter(fact=>fact.status==='supported').flatMap(fact=>fact.supportStates||[]));
}

function applyLedgerDecision({ledger,additions=[],disputes=[],resolutions=[],slotStates,nextFactId}){
  for(const id of arr(disputes).map(String)){const fact=ledger.get(id);if(fact)fact.status='disputed'}
  for(const id of arr(resolutions).map(String)){const fact=ledger.get(id);if(fact)fact.status='supported'}
  for(const row of arr(additions)){
    const factText=text(row?.[0]||'',420);if(!factText)continue;
    const slots=arr(row?.[1]).map(Number).filter(Number.isInteger);
    const supportStates=dedupeStates(slots.flatMap(slot=>arr(slotStates.get(slot))));
    if(!supportStates.length)continue;
    const existing=[...ledger.values()].find(fact=>fact.text.toLowerCase()===factText.toLowerCase());
    if(existing){
      existing.status='supported';
      existing.supportStates=dedupeStates([...(existing.supportStates||[]),...supportStates]);
      continue;
    }
    const id='F'+nextFactId.value++;
    ledger.set(id,{id,text:factText,status:'supported',supportStates});
  }
}

async function decide({
  question,mode,hypothesis='',ledger,path=[],currentState=null,currentWindow=null,
  candidates=[],candidateWindows=[],explorer,client,model,usage,log,step,onProgress=()=>{}
}) {
  const slotStates=new Map(),slots=[];
  if(path.length){slotStates.set(-1,dedupeStates(path));slots.push([-1,path.map(state=>semanticNodeView(state,explorer))])}
  if(currentState&&currentWindow){
    slotStates.set(0,dedupeStates(arr(currentWindow.states)));
    slots.push([0,semanticWindowView(currentState,currentWindow,explorer)]);
  }else{
    for(let index=0;index<candidates.length;index++){
      slotStates.set(index,dedupeStates(arr(candidateWindows[index]?.states)));
      slots.push([index,semanticWindowView(candidates[index],candidateWindows[index],explorer)]);
    }
  }
  const payload={
    q:question,
    h:hypothesis||'',
    f:ledgerView(ledger),
    s:slots,
    c:candidates.map((state,index)=>currentState?[index,semanticNodeView(state,explorer)]:[index,index])
  };
  const system=mode==='causal'?CAUSAL_DECIDE_SYSTEM:QUERY_DECIDE_SYSTEM;
  const call=await modelJson(client,model,system,payload);addUsage(usage,call.usage);
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
    additions:arr(call.parsed?.a),
    disputes:arr(call.parsed?.d),
    resolutions:arr(call.parsed?.r),
    slotStates
  };
  log('query_v5_decision',{step,mode,payload,modelResponse:call.parsed,result:{explained:result.explained,hypothesis:result.hypothesis,picks:picks.map(x=>({name:x.state.name,score:x.score})),additions:result.additions,disputes:result.disputes,resolutions:result.resolutions},usage:call.usage});
  const displayPath=currentState?[...path,currentState]:path;
  onProgress({action:'DECIDE',step,mode,hypothesis:result.hypothesis,explained:result.explained,path:displayPath.map(x=>x.name),facts:ledgerView(ledger),candidates:picks.map(x=>({id:x.state.id,name:x.state.name,navigation:x.score}))});
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

async function classifyRequest({question,client,model,usage,log}){
  const call=await modelJson(client,model,CLASSIFY_SYSTEM,{q:question});addUsage(usage,call.usage);
  const mode=String(call.parsed?.mode||'query').toLowerCase()==='causal'?'causal':'query';
  log('query_v5_mode',{question,mode,usage:call.usage});
  return mode;
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

  const mode=await classifyRequest({question,client,model,usage,log});
  onProgress({action:'MODE',mode});

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

  const visited=new Set(),entryTried=new Set(),stack=[],ledger=new Map(),nextFactId={value:1};
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

      const decision=await decide({question,mode,hypothesis:'',ledger,path:[],candidates,candidateWindows:windows,explorer,client,model,usage,log,step:++step,onProgress});
      applyLedgerDecision({ledger,additions:decision.additions,disputes:decision.disputes,resolutions:decision.resolutions,slotStates:decision.slotStates,nextFactId});
      onProgress({action:'FACTS',facts:ledgerView(ledger),hypothesis:decision.hypothesis,explained:decision.explained});
      const batchEvent={step,action:'ENTRY_BATCH',batch:Math.floor(offset/ENTRY_BATCH_SIZE)+1,start:offset,count:candidates.length,bestNavigation:decision.picks[0]?.score||0,hypothesis:decision.hypothesis,explained:decision.explained};
      events.push(batchEvent);onProgress(batchEvent);

      if(decision.explained){
        const supported=ledgerEvidenceStates(ledger);
        if(!supported.length){
          log('query_v5_invalid_explanation',{step,reason:'explanation has no supported evidence ledger facts'});
          continue;
        }
        finalExplanation=decision.hypothesis||'The supplied semantic evidence answers the request.';
        finalEvidence=supported;
        return true;
      }

      const warm=decision.picks;
      if(!warm.length)continue;

      stack.push({path:[],current:warm[0],alternatives:warm.slice(1),hypothesis:decision.hypothesis});
      const event={step,action:'RESEED',state:warm[0].state.name,hypothesis:decision.hypothesis};
      events.push(event);onProgress({...event,path:[warm[0].state.name]});
      return true;
    }
    return false;
  };

  const seeded=await seed();
  if(!seeded)return {answer:'No learned entry flow produced a usable continuation.',mode,complete:false,explained:false,hypothesis:'',events,usage};

  while(!finalExplanation&&stack.length&&step<MAX_STEPS){
    const frame=stack.at(-1),state=frame.current.state;
    visited.add(state.id);

    const learned=await ensureLocalSemanticWindow({state,path:frame.path,depth:WINDOW_DEPTH,explorer,client,model,usage,log,onProgress});
    const path=[...frame.path,state];
    const next=callChildren(state,explorer,flowChildren).filter(child=>!visited.has(child.id));

    const decision=await decide({
      question,
      mode,
      hypothesis:frame.hypothesis,
      ledger,
      path:frame.path,
      currentState:state,
      currentWindow:learned.window,
      candidates:next,
      explorer,client,model,usage,log,step:++step,onProgress
    });

    applyLedgerDecision({ledger,additions:decision.additions,disputes:decision.disputes,resolutions:decision.resolutions,slotStates:decision.slotStates,nextFactId});
    onProgress({action:'FACTS',facts:ledgerView(ledger),hypothesis:decision.hypothesis,explained:decision.explained});

    if(decision.explained){
      finalExplanation=decision.hypothesis||'The supplied semantic evidence answers the request.';
      finalEvidence=dedupeStates([...ledgerEvidenceStates(ledger),...path,...arr(learned.window?.states)]);
      break;
    }

    const warm=decision.picks;
    if(warm.length){
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
    log('query_v5_complete',{complete:false,mode,explained:false,hypothesis:stack.at(-1)?.hypothesis||'',facts:ledgerView(ledger),events,usage});
    return {answer:mode==='causal'?'The explored semantic evidence did not yet establish the cause.':'The explored semantic evidence did not yet answer the code question.',mode,complete:false,explained:false,hypothesis:stack.at(-1)?.hypothesis||'',facts:ledgerView(ledger),events,usage,investigation:{mode:'code-flow-hypothesis-v5',reasoningMode:mode,usage}};
  }

  onProgress({action:'EXPLAINED',explained:true,hypothesis:finalExplanation});
  const ranges=await localizeExplanation({question,explanation:finalExplanation,evidenceStates:finalEvidence,client,model,usage,log});
  const locations=ranges.map(range=>`${range.sourcePath}#${range.name} ${range.startLine}-${range.endLine}${range.why?' — '+range.why:''}`).join('\n');
  const answer=finalExplanation+(locations?'\n\n'+locations:'');
  log('query_v5_complete',{complete:true,mode,explained:true,hypothesis:finalExplanation,facts:ledgerView(ledger),ranges,events,usage});
  return {answer,mode,complete:true,explained:true,hypothesis:finalExplanation,facts:ledgerView(ledger),ranges,events,usage,investigation:{mode:'code-flow-hypothesis-v5',reasoningMode:mode,usage}};
}
