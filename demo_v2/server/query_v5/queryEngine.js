import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';
import { entryCandidates } from '../semantics/code/queryDrivenSemanticFrontier.js';
import { ensureLocalSemanticWindow, codeSemanticForState } from '../semantics/code/localSemanticLearner.js';

const MAX_STEPS = 64;
const ENTRY_BATCH_SIZE = 20;
const WINDOW_DEPTH = 3;

const CLASSIFY_SYSTEM = `Classify the user's code request into exactly one investigation mode. Use "causal" when the user reports a bug, failure, regression, incorrect behavior, unexpected result, or asks what caused/why something went wrong. Use "query" for descriptive code questions such as how something works, where something is implemented, what happens in a flow, or what code handles something. Return {"mode":"causal"} or {"mode":"query"} only.`;

const CAUSAL_DECIDE_SYSTEM = `Investigate a reported software issue from learned code semantics and the current function body when supplied. The original issue never changes. f is the cumulative evidence ledger as [factId,status,text]. s is the semantic evidence currently visible. b is the raw body of the current function only, when there is one. h is the rolling evidence-backed hypothesis.

Reason causally, not by topical relevance. The issue may contain multiple distinct or related failure components. Do not require one hypothesis to explain every component at once. A strong hypothesis may close one part of the issue while other parts remain unresolved.

At every current function ask in this order:
1. Can this function itself, based on its semantics and b, concretely cause the whole issue or one identifiable part of it?
2. If yes and no downstream call is needed to establish that mechanism, set k=1 and put the concise closed cause in g. Do not continue into child calls merely because they exist.
3. Set x=1 only when the cumulative supported evidence, including any already closed causes in f, explains the whole reported issue. Otherwise x=0 and continue investigating unresolved parts.
4. Only rank child continuations when further execution is actually needed to establish an unresolved cause.

Tests, config helpers, validators, or similarly related code should score low or be omitted unless execution through them could itself cause the reported behavior.

When there is one current traversal window, add explicit behavior established by that current evidence to a as plain fact strings. If k=1, also include the closed causal statement in a so it becomes durable evidence. Do not return evidence IDs or slot IDs. During entry selection, where several independent windows are being compared and no current function body exists, leave a empty and set k=0. Mark contradicted existing facts in d=[factId] and re-supported disputed facts in r=[factId].

h is always the best rolling hypothesis from all evidence seen so far. It may describe one solved component plus unresolved remainder. g is only the cause closed at the current function.

p is [[candidateIndex,causalScore]] for at most 3 continuations, where causalScore means how likely following that branch is to complete an unresolved causal explanation. Do not invent missing evidence. Return {"x":0,"k":0,"g":"","h":"","a":[],"d":[],"r":[],"p":[[0,0.0]]}.`;

const CAUSAL_COMPLETE_SYSTEM = `Decide whether the accumulated supported causal evidence now explains the whole reported software issue. The issue may contain multiple distinct or related parts. q is the original issue, f is the cumulative evidence ledger as [factId,status,text], and h is the rolling hypothesis.

Return x=1 only if the supported evidence collectively explains every material failure described by the issue. If one or more parts remain unexplained, return x=0. h must summarize the best cumulative explanation and, when incomplete, identify the unresolved remainder without inventing facts.

Return {"x":0,"h":""} only.`;

const QUERY_DECIDE_SYSTEM = `Investigate a code question from learned code semantics only. The original question never changes. f is the cumulative evidence ledger as [factId,status,text]. s is the semantic evidence currently visible. h is the current answer hypothesis.

At every position ask whether the full traversed path plus supported facts is sufficient to answer the question. Rank candidate continuations by how much following them is likely to complete the answer. When there is one current traversal window, add explicit behavior established by that current evidence to a as plain fact strings. Do not return evidence IDs or slot IDs. During entry selection leave a empty. Mark contradicted facts in d=[factId] and re-supported disputed facts in r=[factId].

Set x=1 only when the supported facts plus traversed semantic path directly answer the question. Then h is the concise answer. Otherwise x=0 and h is the current evidence-backed answer hypothesis. p is [[candidateIndex,relevanceScore]] for at most 3 continuations. Do not invent missing evidence. Return {"x":0,"h":"","a":[],"d":[],"r":[],"p":[[0,0.0]]}.`;
const LOCALIZE_SYSTEM = `Given an issue, its evidence-backed explanation, and raw source evidence selected by LeMap, identify only the exact source ranges that materially support that explanation. Return {"ranges":[{"ref":0,"startLine":0,"endLine":0,"why":""}]}. Use only supplied evidence refs.`;

function symbolState(symbol, parent=null) {
  return { id:symbol.id, type:'code_symbol', name:symbol.name, symbolId:symbol.id, sourcePath:symbol.sourcePath||'', startLine:symbol.startLine||0, endLine:symbol.endLine||0, body:String(symbol.body||''), parent, parentSymbolId:parent };
}

function externalBoundaryState(boundary){
  return {
    id:boundary.id,
    type:'code_external',
    name:boundary.qualifiedName||boundary.name||boundary.localName||boundary.id,
    symbolId:'',
    sourcePath:boundary.sourcePath||'',
    startLine:Number(boundary.startLine||0),
    endLine:Number(boundary.endLine||boundary.startLine||0),
    body:String(boundary.callText||''),
    parent:null,
    parentSymbolId:null,
    importModule:boundary.importModule||'',
    importName:boundary.importName||'',
    qualifiedName:boundary.qualifiedName||boundary.name||'',
    callText:String(boundary.callText||''),
    keywordArgs:arr(boundary.keywordArgs),
    reExported:!!boundary.reExported,
    boundaryKind:boundary.kind||'external-symbol',
    scopeKind:boundary.scopeKind||'',
    scopeName:boundary.scopeName||''
  };
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

const FACT_STOP_WORDS=new Set(['a','an','and','are','as','at','be','because','by','for','from','in','is','it','of','on','or','that','the','this','to','with']);
function factTokens(value){
  return new Set(String(value||'').toLowerCase().replace(/[^a-z0-9_]+/g,' ').split(/\s+/).filter(token=>token.length>1&&!FACT_STOP_WORDS.has(token)));
}
function sameSupportWindow(a=[],b=[]){
  const left=new Set(arr(a).map(state=>state?.id).filter(Boolean));
  const right=new Set(arr(b).map(state=>state?.id).filter(Boolean));
  if(!left.size||!right.size)return false;
  for(const id of left)if(right.has(id))return true;
  return false;
}
function supportRangesOverlap(a=[],b=[]){
  for(const left of arr(a)){
    if(!left?.symbolId)continue;
    const ls=Number(left.startLine||0),le=Number(left.endLine||left.startLine||0);
    if(!ls||!le)continue;
    for(const right of arr(b)){
      if(right?.symbolId!==left.symbolId)continue;
      const rs=Number(right.startLine||0),re=Number(right.endLine||right.startLine||0);
      if(!rs||!re)continue;
      if(ls<=re&&rs<=le)return true;
    }
  }
  return false;
}
function factSimilarity(left,right){
  const a=factTokens(left),b=factTokens(right);
  if(!a.size||!b.size)return {containment:0,jaccard:0};
  let overlap=0;
  for(const token of a)if(b.has(token))overlap+=1;
  return {
    containment:overlap/Math.min(a.size,b.size),
    jaccard:overlap/(a.size+b.size-overlap)
  };
}
function substantiallySameFact(left,right,{rangeOverlap=false}={}){
  const {containment,jaccard}=factSimilarity(left,right);
  if(rangeOverlap)return containment>=0.65&&jaccard>=0.4;
  return containment>=0.8&&jaccard>=0.55;
}

function applyLedgerDecision({ledger,additions=[],disputes=[],resolutions=[],supportStates=[],nextFactId}){
  for(const id of arr(disputes).map(String)){const fact=ledger.get(id);if(fact)fact.status='disputed'}
  for(const id of arr(resolutions).map(String)){const fact=ledger.get(id);if(fact)fact.status='supported'}
  const boundSupport=dedupeStates(supportStates);
  if(!boundSupport.length)return;
  for(const value of arr(additions)){
    const factText=text(value,420);if(!factText)continue;
    const existing=[...ledger.values()].find((fact)=>{
      if(fact.text.toLowerCase()===factText.toLowerCase())return true;
      const sameWindow=sameSupportWindow(fact.supportStates,boundSupport);
      if(!sameWindow)return false;
      const rangeOverlap=supportRangesOverlap(fact.supportStates,boundSupport);
      return substantiallySameFact(fact.text,factText,{rangeOverlap});
    });
    if(existing){
      existing.status='supported';
      existing.supportStates=dedupeStates([...(existing.supportStates||[]),...boundSupport]);
      continue;
    }
    const id='F'+nextFactId.value++;
    ledger.set(id,{id,text:factText,status:'supported',supportStates:boundSupport});
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
    b:currentState?{
      name:currentState.name,
      sourcePath:currentState.sourcePath,
      startLine:Number(currentState.startLine||0),
      endLine:Number(currentState.endLine||0),
      body:text(currentState.body||'',4200)
    }:null,
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
    causeClosed:currentState&&Number(call.parsed?.k||0)===1,
    closedCause:text(call.parsed?.g||'',700),
    hypothesis:text(call.parsed?.h||hypothesis||'',900),
    picks,
    additions:currentState?arr(call.parsed?.a):[],
    disputes:arr(call.parsed?.d),
    resolutions:arr(call.parsed?.r),
    supportStates:currentState&&currentWindow?dedupeStates(arr(currentWindow.states)):[]
  };
  log('query_v5_decision',{step,mode,payload,modelResponse:call.parsed,result:{explained:result.explained,causeClosed:result.causeClosed,closedCause:result.closedCause,hypothesis:result.hypothesis,picks:picks.map(x=>({name:x.state.name,score:x.score})),additions:result.additions,disputes:result.disputes,resolutions:result.resolutions},usage:call.usage});
  const displayPath=currentState?[...path,currentState]:path;
  onProgress({action:'DECIDE',step,mode,hypothesis:result.hypothesis,explained:result.explained,causeClosed:result.causeClosed,closedCause:result.closedCause,path:displayPath.map(x=>x.name),facts:ledgerView(ledger),candidates:picks.map(x=>({id:x.state.id,name:x.state.name,navigation:x.score}))});
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

async function assessCausalCompleteness({question,hypothesis,ledger,client,model,usage,log,step}) {
  const call=await modelJson(client,model,CAUSAL_COMPLETE_SYSTEM,{q:question,h:hypothesis||'',f:ledgerView(ledger)});
  addUsage(usage,call.usage);
  const result={explained:Number(call.parsed?.x||0)===1,hypothesis:text(call.parsed?.h||hypothesis||'',900)};
  log('query_v5_causal_completeness',{step,payload:{q:question,h:hypothesis||'',f:ledgerView(ledger)},modelResponse:call.parsed,result,usage:call.usage});
  return result;
}

async function classifyRequest({question,client,model,usage,log}){
  const call=await modelJson(client,model,CLASSIFY_SYSTEM,{q:question});addUsage(usage,call.usage);
  const mode=String(call.parsed?.mode||'query').toLowerCase()==='causal'?'causal':'query';
  log('query_v5_mode',{question,mode,usage:call.usage});
  return mode;
}

export async function runCodeFlowQueryV5({question,repoUrl,repoCommit='',explorer,client,model,log=()=>{},onProgress=()=>{}}){
  const usage={prompt:0,completion:0,total:0},events=[];let step=0;
  const diagnosticState={
    learnedNodeIds:new Set(),
    exploredNodeIds:new Set(),
    traversedNodeIds:new Set(),
    traversedRegions:[],
    exploredRegions:[],
    backtracks:0,
    descents:0,
    reseeds:0,
    firstFactStep:null,
    convergenceStep:null
  };
  const regionForState=(state,kind='traversed',atStep=step)=>({
    order:diagnosticState.exploredRegions.length+1,
    step:atStep,
    kind,
    id:state?.id||'',
    symbolId:state?.symbolId||'',
    name:state?.name||'',
    path:state?.sourcePath||'',
    start:Number(state?.startLine||0),
    end:Number(state?.endLine||0)
  });
  const recordExplored=(states,kind='semantic_window',atStep=step)=>{
    for(const state of dedupeStates(states)){
      if(!state?.id||diagnosticState.exploredNodeIds.has(state.id))continue;
      diagnosticState.exploredNodeIds.add(state.id);
      diagnosticState.exploredRegions.push(regionForState(state,kind,atStep));
    }
  };
  const recordTraversed=(state,atStep=step)=>{
    if(!state?.id||diagnosticState.traversedNodeIds.has(state.id))return;
    diagnosticState.traversedNodeIds.add(state.id);
    diagnosticState.traversedRegions.push({
      order:diagnosticState.traversedRegions.length+1,
      step:atStep,
      id:state.id,
      symbolId:state.symbolId||'',
      name:state.name||'',
      path:state.sourcePath||'',
      start:Number(state.startLine||0),
      end:Number(state.endLine||0)
    });
  };
  const emit=(event={})=>{
    if(event.action==='LEARN_DONE')for(const id of arr(event.nodeIds))diagnosticState.learnedNodeIds.add(String(id));
    if(event.action==='BACKTRACK')diagnosticState.backtracks+=1;
    if(event.action==='DESCEND')diagnosticState.descents+=1;
    if(event.action==='RESEED')diagnosticState.reseeds+=1;
    if(event.action==='FACTS'&&diagnosticState.firstFactStep===null&&arr(event.facts).length)diagnosticState.firstFactStep=step;
    if(event.action==='EXPLAINED'&&diagnosticState.convergenceStep===null)diagnosticState.convergenceStep=step;
    onProgress(event);
  };
  const diagnostics=()=>({
    tokens:usage.total,
    learned:diagnosticState.learnedNodeIds.size,
    explored:diagnosticState.exploredNodeIds.size,
    traversed:diagnosticState.traversedNodeIds.size,
    steps:step,
    backtracks:diagnosticState.backtracks,
    reseeds:diagnosticState.reseeds,
    firstFact:diagnosticState.firstFactStep,
    convergedAt:diagnosticState.convergenceStep,
    path:diagnosticState.traversedRegions.map(x=>x.name).filter(Boolean).join(' > ')
  });
  const sweExploreView=(ranges=[])=>({
    regions:arr(ranges).map((range,index)=>({
      rank:index+1,
      path:range.sourcePath||range.path||'',
      start:Number(range.startLine||range.start||0),
      end:Number(range.endLine||range.end||0)
    })).filter(region=>region.path&&region.start>0&&region.end>=region.start)
  });
  const wanted=String(repoUrl||explorer.state?.repoUrl||'').trim();
  if(!wanted)throw new Error('Select a repository before querying code.');

  const requestedCommit=String(repoCommit||'').trim();
  const loadedCommit=String(explorer.state?.commit||'').trim();
  const revisionMismatch=requestedCommit&&(!loadedCommit||!loadedCommit.toLowerCase().startsWith(requestedCommit.toLowerCase()));
  if(!explorer.topology?.callPathIndex||String(explorer.state?.repoUrl||'').trim()!==wanted||revisionMismatch){
    explorer.topology.targetCommit=requestedCommit;
    const preparedResult=await explorer.topology.prepare(wanted);
    const prepared=String(preparedResult?.commit||explorer.topology?.commit||'').trim();
    if(requestedCommit&&!prepared.toLowerCase().startsWith(requestedCommit.toLowerCase()))throw new Error('Prepared repository revision does not match the requested Query v5 commit.');
    explorer.state.repoUrl=wanted;
    explorer.state.commit=prepared;
    explorer.state.runtimeHydration={status:'ready',repoUrl:wanted,commit:prepared};
  }

  const mode=await classifyRequest({question,client,model,usage,log});
  emit({action:'MODE',mode});

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
  const sourceEntries=rankedEntries
    .filter((entry)=>!String(entry.boundaryKind||'').startsWith('test_'))
    .map((entry)=>({entry,state:explorer.topology.symbolById.get(entry.symbolId)}))
    .filter((item)=>item.state)
    .map((item)=>({state:symbolState(item.state),priority:Number(item.entry.boundaryPriority||0)}));
  const testEntries=rankedEntries
    .filter((entry)=>String(entry.boundaryKind||'').startsWith('test_'))
    .map((entry)=>({entry,state:explorer.topology.symbolById.get(entry.symbolId)}))
    .filter((item)=>item.state)
    .map((item)=>({state:symbolState(item.state),priority:Number(item.entry.boundaryPriority||0)}));
  const externalEntries=arr(explorer.topology?.externalSymbols)
    .map((boundary)=>({
      state:externalBoundaryState(boundary),
      priority:boundary?.reExported?650:(boundary?.kind==='external-call'?450:250)
    }));
  const pool=[...(sourceEntries.length?sourceEntries:testEntries),...externalEntries]
    .sort((a,b)=>b.priority-a.priority||String(a.state.name||'').localeCompare(String(b.state.name||'')));
  const entries=pool.map((item)=>item.state);
  if(!entries.length)throw new Error('Prepared repository contains no code entry roots or external API boundaries.');

  const visited=new Set(),entryTried=new Set(),stack=[],ledger=new Map(),nextFactId={value:1};
  let finalExplanation='',finalEvidence=[],rollingHypothesis='';

  const seed=async()=>{
    const remaining=entries.filter(state=>!visited.has(state.id)&&!entryTried.has(state.id));
    if(!remaining.length)return false;

    for(let offset=0;offset<remaining.length;offset+=ENTRY_BATCH_SIZE){
      const candidates=remaining.slice(offset,offset+ENTRY_BATCH_SIZE);
      for(const candidate of candidates)entryTried.add(candidate.id);

      const windows=[];
      for(const candidate of candidates){
        const learned=await ensureLocalSemanticWindow({state:candidate,path:[],depth:WINDOW_DEPTH,explorer,client,model,usage,log,onProgress:emit});
        recordExplored(arr(learned.window?.states),'entry_window',step);
        windows.push(learned.window);
      }

      const decision=await decide({question,mode,hypothesis:rollingHypothesis,ledger,path:[],candidates,candidateWindows:windows,explorer,client,model,usage,log,step:++step,onProgress:emit});
      rollingHypothesis=decision.hypothesis||rollingHypothesis;
      applyLedgerDecision({ledger,additions:decision.additions,disputes:decision.disputes,resolutions:decision.resolutions,supportStates:decision.supportStates,nextFactId});
      emit({action:'FACTS',facts:ledgerView(ledger),hypothesis:decision.hypothesis,explained:decision.explained});
      const batchEvent={step,action:'ENTRY_BATCH',batch:Math.floor(offset/ENTRY_BATCH_SIZE)+1,start:offset,count:candidates.length,bestNavigation:decision.picks[0]?.score||0,hypothesis:decision.hypothesis,explained:decision.explained};
      events.push(batchEvent);emit(batchEvent);

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
      events.push(event);emit({...event,path:[warm[0].state.name]});
      return true;
    }
    return false;
  };

  const seeded=await seed();
  if(!seeded){const diag=diagnostics();log('query_v5_diagnostics',diag);return {answer:'No learned entry flow produced a usable continuation.',mode,complete:false,explained:false,hypothesis:'',events,usage,diagnostics:diag,sweExplore:sweExploreView([])};}

  while(!finalExplanation&&stack.length&&step<MAX_STEPS){
    const frame=stack.at(-1),state=frame.current.state;
    visited.add(state.id);

    const learned=await ensureLocalSemanticWindow({state,path:frame.path,depth:WINDOW_DEPTH,explorer,client,model,usage,log,onProgress:emit});
    recordTraversed(state,step);
    recordExplored(arr(learned.window?.states),'semantic_window',step);
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
      explorer,client,model,usage,log,step:++step,onProgress:emit
    });

    rollingHypothesis=decision.hypothesis||rollingHypothesis;
    applyLedgerDecision({ledger,additions:decision.additions,disputes:decision.disputes,resolutions:decision.resolutions,supportStates:decision.supportStates,nextFactId});
    emit({action:'FACTS',facts:ledgerView(ledger),hypothesis:rollingHypothesis,explained:decision.explained});

    if(decision.explained){
      finalExplanation=decision.hypothesis||'The supplied semantic evidence answers the request.';
      finalEvidence=dedupeStates([...ledgerEvidenceStates(ledger),...path,...arr(learned.window?.states)]);
      break;
    }

    if(mode==='causal'&&decision.causeClosed){
      const closedText=decision.closedCause||decision.hypothesis||'Current function establishes one causal component of the issue.';
      const existing=[...ledger.values()].find((fact)=>fact.text.toLowerCase()===closedText.toLowerCase());
      if(existing){
        existing.status='supported';
        existing.supportStates=dedupeStates([...(existing.supportStates||[]),...arr(learned.window?.states)]);
      }else{
        const id='F'+nextFactId.value++;
        ledger.set(id,{id,text:closedText,status:'supported',supportStates:dedupeStates(arr(learned.window?.states))});
      }
      const event={step,action:'CAUSE_CLOSED',state:state.name,cause:closedText,hypothesis:decision.hypothesis};
      events.push(event);emit({...event,path:path.map(x=>x.name),facts:ledgerView(ledger)});

      const completeness=await assessCausalCompleteness({question,hypothesis:rollingHypothesis,ledger,client,model,usage,log,step});
      rollingHypothesis=completeness.hypothesis||rollingHypothesis;
      emit({action:'FACTS',facts:ledgerView(ledger),hypothesis:rollingHypothesis,explained:completeness.explained});
      if(completeness.explained){
        finalExplanation=rollingHypothesis||closedText;
        finalEvidence=ledgerEvidenceStates(ledger);
        break;
      }

      stack.pop();
      let resumed=false;
      while(stack.length){
        const top=stack.at(-1);
        if(top.alternatives.length){
          top.current=top.alternatives.shift();
          const backtrack={step,action:'BACKTRACK',to:top.current.state.name,hypothesis:decision.hypothesis};
          events.push(backtrack);emit({...backtrack,path:[...top.path,top.current.state].map(x=>x.name)});
          resumed=true;
          break;
        }
        stack.pop();
      }
      if(!resumed){
        if(!(await seed()))break;
      }
      continue;
    }

    const warm=decision.picks;
    if(warm.length){
      stack.push({path,current:warm[0],alternatives:warm.slice(1),hypothesis:decision.hypothesis});
      const event={step,action:'DESCEND',from:state.name,to:warm[0].state.name,hypothesis:decision.hypothesis};
      events.push(event);emit({...event,path:[...path,warm[0].state].map(x=>x.name)});
      continue;
    }

    let resumed=false;
    while(stack.length){
      const top=stack.at(-1);
      if(top.alternatives.length){
        top.current=top.alternatives.shift();
        const event={step,action:'BACKTRACK',to:top.current.state.name,hypothesis:top.hypothesis};
        events.push(event);emit({...event,path:[...top.path,top.current.state].map(x=>x.name)});
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
    emit({action:'SEARCH_COMPLETE',explained:false,hypothesis:rollingHypothesis||stack.at(-1)?.hypothesis||''});
    log('query_v5_complete',{complete:false,mode,explained:false,hypothesis:rollingHypothesis||stack.at(-1)?.hypothesis||'',facts:ledgerView(ledger),events,usage});
    const diag=diagnostics();log('query_v5_diagnostics',diag);
    return {answer:mode==='causal'?'The explored semantic evidence did not yet establish the full cause.':'The explored semantic evidence did not yet answer the code question.',mode,complete:false,explained:false,hypothesis:rollingHypothesis||stack.at(-1)?.hypothesis||'',facts:ledgerView(ledger),events,usage,diagnostics:diag,sweExplore:sweExploreView([]),investigation:{mode:'code-flow-hypothesis-v5',reasoningMode:mode,usage}};
  }

  emit({action:'EXPLAINED',explained:true,hypothesis:finalExplanation});
  const ranges=(await localizeExplanation({question,explanation:finalExplanation,evidenceStates:finalEvidence,client,model,usage,log})).map((range,index)=>({...range,rank:index+1}));
  const locations=ranges.map(range=>`${range.sourcePath}#${range.name} ${range.startLine}-${range.endLine}${range.why?' — '+range.why:''}`).join('\n');
  const answer=finalExplanation+(locations?'\n\n'+locations:'');
  log('query_v5_complete',{complete:true,mode,explained:true,hypothesis:finalExplanation,facts:ledgerView(ledger),ranges,events,usage});
  const diag=diagnostics();log('query_v5_diagnostics',diag);
  return {answer,mode,complete:true,explained:true,hypothesis:finalExplanation,facts:ledgerView(ledger),ranges,events,usage,diagnostics:diag,sweExplore:sweExploreView(ranges),investigation:{mode:'code-flow-hypothesis-v5',reasoningMode:mode,usage}};
}
