import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';
import { ensureLocalSemanticWindow, codeSemanticForState } from '../semantics/code/localSemanticLearner.js';
import { selectCodeEntries } from './codeEntrySelector.js';

const MAX_STEPS = 64;
const ENTRY_BATCH_SIZE = 20;
const ENTRY_TRIAGE_LIMIT = 4;
const WINDOW_DEPTH = 3;
const GOAL_CLOSE_SCORE = 0.9;
const HYPOTHESIS_DELTA_EPSILON = 0.03;
const MAX_FLAT_STEPS = 2;

const GOAL_DECOMPOSE_SYSTEM = `Read the user's software-engineering request as one stable issue that may contain several interdependent obligations. Decompose only the material obligations needed to satisfy the request. A goal kind must be one of "locate", "describe", "causal", "change", or "verify".

Use:
- locate only when locating or identifying code is itself an explicit requested outcome. Do not create a locate goal merely because another goal will need to find code; every investigation already performs structural localization as part of its own search.
- describe for understanding existing behavior or flow.
- causal for explaining why a reported condition, failure, regression, incorrect behavior, or unexpected result occurs.
- change for establishing what existing implementation a requested modification applies to and how.
- verify for checking a stated constraint, compatibility requirement, side effect, or consequence.

Prefer the smallest coherent goal set. If one goal can preserve and answer the complete request, do not split it.

If the request must be split, the decomposition must be lossless. The goals plus their dependency relationships must collectively preserve every material condition, discriminator, scope restriction, symptom, and requested outcome from the original request. Never remove an important condition from an earlier goal merely because a later goal mentions it. If a condition is needed to correctly identify or reason about evidence for a goal, keep that condition in that goal's text.

Dependencies represent information flow. When goal G2 depends on G1, G2 is expected to consume the evidence established by G1, and its wording must remain coherent with that dependency. A dependent chain must collectively handle the complete original request; splitting must not create narrower subproblems whose combination loses part of the issue.

Before returning the goals, mentally verify:
1. Would solving all goals in dependency order fully answer the original request?
2. Has every material condition from the request survived into at least the goals that need it?
3. Is any locate goal present only because code must be found internally? If yes, remove it and let the substantive goal perform localization itself.
4. Could two adjacent goals be one coherent goal without losing useful dependency structure? If yes, merge them.

For every goal, also derive its acceptance criteria once at decomposition time:
- hardConstraints: the minimum exact conditions that must be established for that goal to count as satisfied.
- optionalConstraints: conditions that strengthen confidence or context but are not mandatory.
Derive these only from the original request and the goal. Do not mention candidate code, implementation mechanisms, filenames, symbols, or source details unless they are explicitly stated in the request itself. These constraints are immutable during traversal.

Do not turn rationale, examples, proposed APIs, or incidental wording into separate goals unless the request actually requires them to be established. Keep the set small, normally 1-5 goals and never more than 6. Do not solve the goals. Return {"goals":[{"id":"G1","kind":"causal","text":"","dependsOn":[],"hardConstraints":[],"optionalConstraints":[]}]} only.`;

const GOAL_DECIDE_SYSTEM = `Search a learned semantic code space for evidence that satisfies one active software-engineering goal.

q is the original request.
g is the goal ledger as [goalId,kind,status,text,dependsOn,hardConstraints,optionalConstraints].
u is the active goal ID.
f is previously established evidence as [factId,status,sourceGoalId,sourceGoalKind,text].
h is the rolling evidence-backed hypothesis.
n is the semantic node currently being visited, or null during entry comparison.
c is the set of semantic navigation candidates as [candidateIndex,type,name,purpose,effect].
src is exact source for n only when you explicitly requested source inspection on the previous decision.
m contains structural code matches only during entry localization.

Treat this as search. Structure bootstraps the semantic space; Learn fills missing semantics; Query walks semantic functions, regions and branches. Source is not normal traversal evidence. Use exact code only when it is supplied in src or in entry-stage structural matches.

ENTRY STAGE: when n is null, rank the candidate semantic entries in p. Do not form a causal/change/verification conclusion, do not add facts, do not request source, and report goal score 0. Return h="".

SEMANTIC WALK: when n is present, treat h as the accumulated explanation for the active goal. Integrate only evidence from the current visited node (and src when supplied) into h. Do not treat unvisited lookahead nodes as evidence.
- The active goal already contains immutable hardConstraints and optionalConstraints created before traversal. Never add, remove, rewrite, reinterpret, or replace them from candidate evidence.
- Score the UPDATED accumulated hypothesis against those fixed constraints. Return ck as [[constraintIndex,score],...] using concatenated hardConstraints then optionalConstraints, with each score 0..1. The constraint text itself must not be returned.
- hs is the overall hypothesis-match score 0..1. It summarizes how well the accumulated evidence-backed hypothesis satisfies the active goal. Hard constraints dominate this score.
- gs reports goal sufficiency as [[goalId,score]]. It should agree with the hypothesis/constraint evidence. Use 1.0 when the hypothesis is sufficient to answer the goal; do not reserve 1.0 for exhaustive repository certainty.
- l contains bounded semantic lookahead for each immediate candidate. Lookahead is navigation evidence only. Use it to estimate whether a branch is likely to strengthen the hypothesis, stay flat, or weaken it, especially for currently weak hard constraints.
- p ranks at most 3 immediate semantic continuations. Return rows as [candidateIndex,expectedHypothesisScore,[constraintIndexes]]. The score is the expected hypothesis match after useful exploration down that branch, not generic relevance. constraintIndexes are unresolved constraints that the branch appears capable of improving.
- a contains only explicit facts established by the visited semantic node or by src when present. Every item in a must be a plain string, never an array or object.
- i=1 requests exact source for the CURRENT semantic node when its semantics materially affect the hypothesis but exact code is needed to establish or reject an unresolved hard constraint. Otherwise i=0.
- Do not request source merely to browse. When src is present, use it to update h and the constraint scores, and do not request source again in that decision.

For causal goals, compare candidate mechanisms against the distinguishing conditions in the issue. For change goals, establish the current implementation and how the requested change applies. For describe goals, establish the requested behavior or flow. For verify goals, establish the stated constraint or consequence. Locate goals close when the semantic/structural evidence identifies the requested implementation.

Never invent implementation details not present in learned semantics, supported facts, entry structural matches, or supplied src. Return only:
{"h":"","gs":[["G1",0.0]],"ck":[[0,0.0]],"hs":0.0,"a":[],"d":[],"r":[],"i":0,"p":[[0,0.0,[0]]]}.
`;

const ENTRY_TRIAGE_SYSTEM = `Rank structural entry matches before any semantic Learn expansion. q is the original issue or question. c contains compact matched source candidates as [index,name,path,[[line,source],...],target]. Choose at most ${ENTRY_TRIAGE_LIMIT} candidates whose supplied evidence most directly relates to q. Prefer explicit evidence over inferred structure. Do not invent intermediate components, relationships, behavior, or missing implementation that are not present in c. Return {"p":[[candidateIndex,score]]}. Scores are 0..1.`;


const LOCALIZE_SYSTEM = `Given an issue, its evidence-backed explanation, and raw source evidence selected by LeMap, identify only the exact source ranges that materially support that explanation. Return {"ranges":[{"ref":0,"startLine":0,"endLine":0,"why":""}]}. Use only supplied evidence refs.`;

function symbolState(symbol, parent=null) {
  return { id:symbol.id, type:'code_symbol', name:symbol.name, symbolId:symbol.id, sourcePath:symbol.sourcePath||'', startLine:symbol.startLine||0, endLine:symbol.endLine||0, body:String(symbol.body||''), parent, parentSymbolId:parent };
}

function regexMatchRegions(symbol,candidate){
  const matches=arr(candidate?.matches).filter(match=>Number(match?.line||0)>0);
  if(!symbol||!matches.length)return [];
  const byLine=new Map();
  for(const match of matches){
    const line=Number(match.line);
    if(!byLine.has(line))byLine.set(line,[]);
    byLine.get(line).push({line,text:String(match.text||''),pattern:String(match.pattern||'')});
  }
  const bodyLines=String(symbol.body||'').split(/\r?\n/);
  return [...byLine.entries()].sort((a,b)=>a[0]-b[0]).map(([line,matchedLines])=>{
    const start=Math.max(Number(symbol.startLine||line),line-2);
    const end=Math.min(Number(symbol.endLine||line),line+2);
    const offset=Math.max(0,start-Number(symbol.startLine||start));
    const count=Math.max(1,end-start+1);
    const regionId=`regex-region:${symbol.id}:${line}`;
    return {
      id:regionId,
      regionId,
      type:'code_region',
      name:`${symbol.name} [regex match @ ${line}]`,
      symbolId:symbol.id,
      sourcePath:symbol.sourcePath||'',
      startLine:start,
      endLine:end,
      body:bodyLines.slice(offset,offset+count).join('\n'),
      parent:symbol.id,
      parentSymbolId:symbol.id,
      kind:'regex-match',
      matchedLines
    };
  });
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
    scopeName:boundary.scopeName||'',
    targetExternalId:boundary.targetExternalId||'',
    viaModule:boundary.viaModule||''
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

function fallbackCodeEntries(topology, limit=40) {
  const symbols=typeof topology?.entrySymbols==='function'
    ? topology.entrySymbols()
    : [...(topology?.symbolById?.values?.()||[])];
  return symbols
    .filter(symbol=>symbol?.id&&symbol?.executable!==false)
    .map(symbol=>({
      symbol,
      priority:Number(typeof topology?.entryPriority==='function'?topology.entryPriority(symbol):0)
        +(String(symbol?.sourceRole||'source')==='test'?-100:0)
    }))
    .sort((a,b)=>b.priority-a.priority||String(a.symbol?.name||'').localeCompare(String(b.symbol?.name||'')))
    .slice(0,Math.max(1,Number(limit)||40))
    .map(item=>symbolState(item.symbol));
}


function semanticNodeView(state,explorer){
  const semantic=codeSemanticForState(state,explorer)||{};
  return [state?.type||'',state?.name||'',text(semantic.purpose||'',320),text(semantic.effect||'',280)];
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
  const tree=visit(rootState.id)||[...semanticNodeView(rootState,explorer),[]];
  const highlights=arr(window?.highlights).map(region=>({
    name:region.name,
    source:arr(region.matchedLines).map(match=>[match.line,match.text,match.pattern]),
    semantic:semanticNodeView(region,explorer)
  }));
  return highlights.length?[...tree,{regexMatches:highlights}]:tree;
}

function dedupeStates(states=[]){
  const seen=new Set(),out=[];
  for(const state of arr(states)){if(!state?.id||seen.has(state.id))continue;seen.add(state.id);out.push(state)}
  return out;
}

function semanticRegionChildren(state,window){
  const byId=new Map(arr(window?.states).map(item=>[item.id,item]));
  const ids=arr(window?.links)
    .filter(link=>link?.relationship==='contains'&&String(link?.from||'')===String(state?.id||''))
    .map(link=>link.to);
  return dedupeStates(ids.map(id=>byId.get(id)).filter(region=>region?.type==='code_region'&&region?.kind!=='regex-match'))
    .sort((a,b)=>Number(a.startLine||0)-Number(b.startLine||0)||Number(a.endLine||0)-Number(b.endLine||0));
}

function semanticLookaheadView(candidates=[],window,explorer,maxDepth=3){
  const byId=new Map(arr(window?.states).map(state=>[state.id,state]));
  const children=new Map();
  for(const link of arr(window?.links)){
    if(!['contains','calls'].includes(String(link?.relationship||'')))continue;
    if(!children.has(link.from))children.set(link.from,[]);
    children.get(link.from).push(link.to);
  }
  const walk=(state,depth,seen=new Set())=>{
    if(!state?.id||depth>maxDepth||seen.has(state.id))return null;
    const nextSeen=new Set(seen);nextSeen.add(state.id);
    const kids=depth===maxDepth?[]:arr(children.get(state.id))
      .map(id=>byId.get(id)).filter(Boolean)
      .map(child=>walk(child,depth+1,nextSeen)).filter(Boolean);
    return [...semanticNodeView(state,explorer),kids];
  };
  return arr(candidates).map((state,index)=>[index,walk(state,1)]).filter(row=>row[1]);
}

function hypothesisProgress(previous,current){
  const delta=Number(current||0)-Number(previous||0);
  if(delta>HYPOTHESIS_DELTA_EPSILON)return {trend:'strengthening',delta};
  if(delta<-HYPOTHESIS_DELTA_EPSILON)return {trend:'weakening',delta};
  return {trend:'flat',delta};
}

function dependencyGoalIds(goals=[],activeGoalId=''){
  const byId=new Map(arr(goals).map(goal=>[goal.id,goal]));
  const out=new Set(),queue=[...(byId.get(activeGoalId)?.dependsOn||[])];
  while(queue.length){
    const id=String(queue.shift()||'');
    if(!id||out.has(id))continue;
    out.add(id);
    queue.push(...arr(byId.get(id)?.dependsOn));
  }
  return out;
}

function ledgerView(ledger,{goals=[],activeGoalId='',all=false}={}){
  const dependencies=dependencyGoalIds(goals,activeGoalId);
  return [...ledger.values()]
    .filter(fact=>all||!activeGoalId||fact.goalId===activeGoalId||dependencies.has(fact.goalId))
    .map(fact=>[fact.id,fact.status,fact.goalId||'',fact.goalKind||'',fact.text]);
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

function applyLedgerDecision({ledger,goal,additions=[],disputes=[],resolutions=[],supportStates=[],nextFactId}){
  for(const id of arr(disputes).map(String)){
    const fact=ledger.get(id);
    if(fact)fact.status='disputed';
  }
  for(const id of arr(resolutions).map(String)){
    const fact=ledger.get(id);
    if(fact)fact.status='supported';
  }
  const boundSupport=dedupeStates(supportStates);
  if(!boundSupport.length||!goal||goal.kind==='locate')return;
  for(const value of arr(additions)){
    if(typeof value!=='string')continue;
    const factText=text(value,420);if(!factText)continue;
    const existing=[...ledger.values()].find((fact)=>{
      if(fact.goalId!==goal.id)return false;
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
    ledger.set(id,{id,text:factText,status:'supported',goalId:goal.id,goalKind:goal.kind,supportStates:boundSupport});
  }
}

function addResolvedLocationFact({ledger,goal,state,supportStates=[],nextFactId}){
  if(!goal||goal.kind!=='locate'||!state?.name)return null;
  const existing=[...ledger.values()].find(fact=>fact.goalId===goal.id&&fact.goalKind==='locate');
  const factText=`Relevant existing implementation for ${goal.text}: ${state.name}.`;
  if(existing){
    existing.text=factText;
    existing.status='supported';
    existing.supportStates=dedupeStates([...(existing.supportStates||[]),...arr(supportStates)]);
    return existing.id;
  }
  const id='F'+nextFactId.value++;
  ledger.set(id,{id,text:factText,status:'supported',goalId:goal.id,goalKind:'locate',supportStates:dedupeStates(supportStates)});
  return id;
}

function normalizeGoals(items=[]){
  const allowed=new Set(['locate','describe','causal','change','verify']);
  const raw=arr(items).slice(0,6);
  const ids=new Set();
  const out=[];
  for(let i=0;i<raw.length;i++){
    const item=raw[i]||{};
    let id=String(item.id||`G${i+1}`).trim();
    if(!/^G[1-9][0-9]*$/i.test(id)||ids.has(id))id=`G${i+1}`;
    ids.add(id);
    const kind=allowed.has(String(item.kind||'').toLowerCase())?String(item.kind).toLowerCase():'describe';
    const goalText=text(item.text||'',420);
    if(!goalText)continue;
    const hardConstraints=arr(item.hardConstraints).map(value=>text(value,320)).filter(Boolean).slice(0,8);
    const optionalConstraints=arr(item.optionalConstraints).map(value=>text(value,320)).filter(Boolean).slice(0,8);
    if(!hardConstraints.length)hardConstraints.push(goalText);
    out.push({id,kind,text:goalText,dependsOn:arr(item.dependsOn).map(String),hardConstraints,optionalConstraints,status:'unresolved',supportStates:[],summary:''});
  }
  const validIds=new Set(out.map(goal=>goal.id));
  for(const goal of out)goal.dependsOn=goal.dependsOn.filter(id=>id!==goal.id&&validIds.has(id));
  return out.length?out:[{id:'G1',kind:'describe',text:'Answer the software-engineering request from repository evidence.',dependsOn:[],hardConstraints:['The repository evidence answers the requested software-engineering question.'],optionalConstraints:[],status:'unresolved',supportStates:[],summary:''}];
}

function goalView(goals=[]){
  return arr(goals).map(goal=>[goal.id,goal.kind,goal.status,goal.text,arr(goal.dependsOn),arr(goal.hardConstraints),arr(goal.optionalConstraints)]);
}

function goalEvidenceStates(goals=[]){
  return dedupeStates(arr(goals).filter(goal=>goal.status==='resolved').flatMap(goal=>goal.supportStates||[]));
}

function unresolvedGoals(goals=[]){return arr(goals).filter(goal=>goal.status!=='resolved')}

function allGoalsResolved(goals=[]){return arr(goals).length>0&&unresolvedGoals(goals).length===0}

function reasoningModeForGoals(goals=[]){
  const kinds=[...new Set(arr(goals).map(goal=>goal.kind).filter(kind=>kind!=='locate'))];
  if(kinds.length===1){
    if(kinds[0]==='causal')return 'causal';
    if(kinds[0]==='change')return 'change';
    if(kinds[0]==='describe')return 'query';
    return kinds[0];
  }
  return kinds.length?'mixed':'query';
}

function applyGoalResolutions({goals,resolvedIds=[],supportStates=[]}){
  const support=dedupeStates(supportStates);
  if(!support.length)return [];
  const requested=new Set(arr(resolvedIds).map(String));
  const changed=[];
  let progress=true;
  while(progress){
    progress=false;
    for(const goal of arr(goals)){
      if(goal.status==='resolved'||!requested.has(goal.id))continue;
      const dependenciesSatisfied=arr(goal.dependsOn).every(id=>{
        const dep=arr(goals).find(item=>item.id===id);
        return !dep||dep.status==='resolved'||requested.has(id);
      });
      if(!dependenciesSatisfied)continue;
      goal.status='resolved';
      goal.supportStates=dedupeStates([...(goal.supportStates||[]),...support]);
      changed.push(goal.id);
      progress=true;
    }
  }
  return changed;
}

async function decomposeGoals({question,client,model,usage,log}){
  const call=await modelJson(client,model,GOAL_DECOMPOSE_SYSTEM,{q:question});addUsage(usage,call.usage);
  const goals=normalizeGoals(call.parsed?.goals);
  const mode=reasoningModeForGoals(goals);
  log('query_v5_goals',{question,mode,goals:goalView(goals),usage:call.usage});
  return {goals,mode};
}

async function decide({
  question,mode,goals=[],activeGoalId='',hypothesis='',ledger,path=[],currentState=null,currentWindow=null,
  candidates=[],candidateWindows=[],lookahead=[],sourceBody='',explorer,client,model,usage,log,step,onProgress=()=>{}
}) {
  const entryStage=!currentState;
  const entryMatches=entryStage
    ? candidates.map((state,index)=>({
        index,
        name:state.name,
        matches:arr(candidateWindows[index]?.highlights).flatMap(region=>
          arr(region?.matchedLines).map(match=>[Number(match?.line||0),text(match?.text||'',260),String(match?.pattern||'')])
        )
      })).filter(item=>item.matches.length)
    : [];

  const payload={
    q:question,
    g:goalView(goals),
    u:String(activeGoalId||''),
    h:hypothesis||'',
    f:ledgerView(ledger,{goals,activeGoalId}),
    n:currentState?semanticNodeView(currentState,explorer):null,
    src:sourceBody?{
      name:currentState?.name||'',
      sourcePath:currentState?.sourcePath||'',
      startLine:Number(currentState?.startLine||0),
      endLine:Number(currentState?.endLine||0),
      body:text(sourceBody,4200)
    }:null,
    m:entryMatches,
    c:candidates.map((state,index)=>[index,...semanticNodeView(state,explorer)]),
    l:entryStage?[]:lookahead
  };

  const call=await modelJson(client,model,GOAL_DECIDE_SYSTEM,payload);addUsage(usage,call.usage);
  const byIndex=new Map(candidates.map((state,index)=>[String(index),state]));
  const picks=[];
  for(const row of arr(call.parsed?.p)){
    const state=byIndex.get(String(row?.[0]));if(!state)continue;
    const score=Math.max(0,Math.min(1,Number(row?.[1]||0)));
    if(!(score>0))continue;
    const targets=arr(row?.[2]).map(Number).filter(Number.isInteger);
    picks.push({state,score,targets});
  }
  picks.sort((a,b)=>b.score-a.score);

  const goalScores=new Map();
  if(!entryStage){
    for(const row of arr(call.parsed?.gs)){
      const id=String(row?.[0]||'');
      if(!id)continue;
      goalScores.set(id,Math.max(0,Math.min(1,Number(row?.[1]||0))));
    }
  }
  const activeGoalScore=entryStage?0:Number(goalScores.get(String(activeGoalId||''))||0);
  const activeGoal=arr(goals).find(goal=>goal.id===activeGoalId);
  const fixedConstraints=[
    ...arr(activeGoal?.hardConstraints).map((value,index)=>({index,text:value,kind:'hard'})),
    ...arr(activeGoal?.optionalConstraints).map((value,index)=>({index:arr(activeGoal?.hardConstraints).length+index,text:value,kind:'support'}))
  ];
  const scoreByIndex=new Map();
  if(!entryStage){
    for(const row of arr(call.parsed?.ck)){
      const index=Number(row?.[0]);
      if(!Number.isInteger(index)||index<0||index>=fixedConstraints.length)continue;
      scoreByIndex.set(index,Math.max(0,Math.min(1,Number(row?.[1]||0))));
    }
  }
  const constraintChecklist=!entryStage
    ? fixedConstraints.map(item=>[item.text,Number(scoreByIndex.get(item.index)||0),item.kind])
    : [];
  const hardScores=constraintChecklist.filter(row=>row[2]==='hard').map(row=>Number(row[1]||0));
  const modelHypothesisScore=!entryStage?Math.max(0,Math.min(1,Number(call.parsed?.hs||0))):0;
  const hypothesisScore=hardScores.length
    ? hardScores.reduce((sum,value)=>sum+value,0)/hardScores.length
    : modelHypothesisScore||activeGoalScore;
  const hardConstraintsMet=!entryStage&&hardScores.length>0&&hardScores.every(score=>score>=GOAL_CLOSE_SCORE);
  // Goal closure is anchored in the accumulated hypothesis satisfying every
  // hard acceptance constraint. gs remains a model diagnostic, not the sole
  // convergence switch.
  const goalResolutions=hardConstraintsMet?[String(activeGoalId)]:[];
  const inspectSource=!entryStage&&!sourceBody&&Number(call.parsed?.i||0)===1;
  const unresolvedOther=arr(goals).some(goal=>goal.id!==activeGoalId&&goal.status!=='resolved');
  const result={
    explained:hardConstraintsMet&&!unresolvedOther,
    hypothesis:entryStage?'':text(call.parsed?.h||hypothesis||'',900),
    picks,
    additions:entryStage?[]:arr(call.parsed?.a),
    disputes:entryStage?[]:arr(call.parsed?.d),
    resolutions:entryStage?[]:arr(call.parsed?.r),
    goalResolutions,
    goalScores:[...goalScores.entries()],
    activeGoalScore,
    hypothesisScore,
    hardConstraintsMet,
    constraintChecklist,
    inspectSource,
    supportStates:currentState?[currentState]:[]
  };

  log('query_v5_decision',{step,mode,payload,modelResponse:call.parsed,result:{
    explained:result.explained,hypothesis:result.hypothesis,
    picks:picks.map(x=>({name:x.state.name,score:x.score})),
    goalScores:result.goalScores,hypothesisScore:result.hypothesisScore,hardConstraintsMet:result.hardConstraintsMet,constraintChecklist:result.constraintChecklist,inspectSource:result.inspectSource,
    additions:result.additions,disputes:result.disputes,resolutions:result.resolutions,
    goalResolutions:result.goalResolutions
  },usage:call.usage});

  const displayPath=currentState?[...path,currentState]:path;
  onProgress({
    action:'DECIDE',step,mode,hypothesis:result.hypothesis,explained:result.explained,
    goalScores:result.goalScores,hypothesisScore:result.hypothesisScore,hardConstraintsMet:result.hardConstraintsMet,constraintChecklist:result.constraintChecklist,inspectSource:result.inspectSource,goals:goalView(goals),
    path:displayPath.map(x=>x.name),facts:ledgerView(ledger,{all:true}),
    candidates:picks.map(x=>({id:x.state.id,name:x.state.name,navigation:x.score,targets:x.targets}))
  });
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

async function triageEntryCandidates({question,candidates=[],client,model,usage,log}){
  const compact=arr(candidates).map((candidate,index)=>[
    index,
    candidate?.name||candidate?.symbolName||candidate?.externalName||'',
    candidate?.sourcePath||'',
    arr(candidate?.matches).slice(0,4).map(match=>[Number(match?.line||0),text(match?.text||'',220)]),
    candidate?.metadata?.qualifiedName||candidate?.externalName||''
  ]);
  if(compact.length<=ENTRY_TRIAGE_LIMIT)return arr(candidates);
  const call=await modelJson(client,model,ENTRY_TRIAGE_SYSTEM,{q:question,c:compact});addUsage(usage,call.usage);
  const byIndex=new Map(arr(candidates).map((candidate,index)=>[String(index),candidate]));
  const ranked=[];
  for(const row of arr(call.parsed?.p)){
    const candidate=byIndex.get(String(row?.[0]));if(!candidate)continue;
    ranked.push({candidate,score:Number(row?.[1]||0)});
  }
  ranked.sort((a,b)=>b.score-a.score);
  const selected=ranked.slice(0,ENTRY_TRIAGE_LIMIT).map(item=>item.candidate);
  const fallback=selected.length?selected:arr(candidates).slice(0,ENTRY_TRIAGE_LIMIT);
  log('query_v5_entry_triage',{candidateCount:compact.length,selected:fallback.map(candidate=>({name:candidate?.name||candidate?.symbolName||candidate?.externalName||'',sourcePath:candidate?.sourcePath||'',startLine:Number(candidate?.startLine||0),matches:arr(candidate?.matches).slice(0,4)})),usage:call.usage});
  return fallback;
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
    onProgress({...event,tokens:{prompt:usage.prompt,completion:usage.completion,total:usage.total}});
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
  const loadedCommit=String(explorer.topology?.commit||explorer.state?.commit||'').trim();
  const revisionMismatch=requestedCommit&&(!loadedCommit||!loadedCommit.toLowerCase().startsWith(requestedCommit.toLowerCase()));
  const sameRepo=String(explorer.topology?.repoUrl||'').trim()===wanted;
  const localTopologyReady=sameRepo&&!revisionMismatch
    &&Array.isArray(explorer.topology?.constructIndex)&&explorer.topology.constructIndex.length>0
    &&Number(explorer.topology?.symbolById?.size||0)>0;

  if(!localTopologyReady){
    explorer.topology.targetCommit=requestedCommit;
    const prepareStarted=Date.now();
    console.log(`[query-v5] preparing query-local topology repo=${wanted} revision=${requestedCommit||'HEAD'}`);
    emit({action:'PREPARE_TOPOLOGY',mode:'',detail:'Hydrating structural index and local AST call graph for Query.'});
    const preparedResult=typeof explorer.topology?.prepareCodeQuery==='function'
      ? await explorer.topology.prepareCodeQuery(wanted)
      : await explorer.topology.prepare(wanted);
    console.log(`[query-v5] query-local topology ready ${Date.now()-prepareStarted}ms globalCallPaths=${preparedResult?.codeQueryTopology?'skipped':'prepared'}`);
    emit({action:'TOPOLOGY_READY',mode:'',detail:'Structural query topology ready. Starting faceted entry selection.'});
    const prepared=String(preparedResult?.commit||explorer.topology?.commit||'').trim();
    if(requestedCommit&&!prepared.toLowerCase().startsWith(requestedCommit.toLowerCase()))throw new Error('Prepared repository revision does not match the requested Query v5 commit.');
    explorer.state.repoUrl=wanted;
    explorer.state.commit=prepared;
    explorer.state.runtimeHydration={status:'ready',repoUrl:wanted,commit:prepared,scope:preparedResult?.codeQueryTopology?'query-local':'full'};
  }

  const goalPlan=await decomposeGoals({question,client,model,usage,log});
  const goals=goalPlan.goals;
  const mode=goalPlan.mode;
  emit({action:'GOALS',mode,goals:goalView(goals)});

  explorer.state.semanticProfile='code';
  const flowChildren=null;

  const fallbackRoots=fallbackCodeEntries(explorer.topology,40);
  const externalEntries=arr(explorer.topology?.externalSymbols)
    .map((boundary)=>({
      state:externalBoundaryState(boundary),
      priority:boundary?.reExported?650:(boundary?.kind==='external-call'?(arr(boundary?.keywordArgs).length?600:450):250)
    }))
    .sort((a,b)=>b.priority-a.priority||String(a.state.name||'').localeCompare(String(b.state.name||'')))
    .slice(0,20)
    .map(item=>item.state);
  const fallbackPool=[...fallbackRoots,...externalEntries];
  const externalById=new Map(arr(explorer.topology?.externalSymbols).map(boundary=>[String(boundary?.id||''),boundary]));

  const ledger=new Map(),nextFactId={value:1};
  let finalExplanation='',finalEvidence=[],rollingHypothesis='';
  const threads=new Map(goals.map(goal=>[goal.id,{
    goal,
    searched:false,
    exhausted:false,
    entrySelection:null,
    entryTiers:[],
    visited:new Set(),
    entryTried:new Set(),
    stack:[],
    batchNumber:0,
    hypothesis:'',
    hypothesisScore:0,
    bestHypothesis:'',
    bestScore:0,
    bestConstraintChecklist:[],
    flatSteps:0
  }]));

  const dependenciesResolved=(goal)=>arr(goal.dependsOn).every(id=>goals.find(item=>item.id===id)?.status==='resolved');
  const schedulableGoals=()=>goals.filter(goal=>goal.status!=='resolved'&&dependenciesResolved(goal)&&!threads.get(goal.id)?.exhausted);
  const goalSearchQuestion=(goal)=>[
    question,
    '',
    `Current evidence obligation ${goal.id} [${goal.kind}]: ${goal.text}`,
    'Use the full request as context, but localize code specifically for this obligation.'
  ].join('\n');

  const prepareGoalEntries=async(thread)=>{
    if(thread.searched)return;
    const goal=thread.goal;
    const searchQuestion=goalSearchQuestion(goal);
    emit({action:'GOAL_SEARCH',goalId:goal.id,goal:goal.text,kind:goal.kind});

    const entrySelection=await selectCodeEntries({question:searchQuestion,mode:goal.kind,topology:explorer.topology,client,model,usage,log});
    thread.entrySelection=entrySelection;
    const bestEntry=entrySelection.candidates[0];
    const searchCount=entrySelection.plan.strategy==='structured_search'?entrySelection.plan.searches.length:entrySelection.plan.patterns.length;
    console.log(`[goal-entry-search] goal=${goal.id} ${entrySelection.plan.strategy} searches=${searchCount} hits=${entrySelection.hits.length} candidates=${entrySelection.candidates.length}${bestEntry?` best=${bestEntry.sourcePath}#${bestEntry.name||bestEntry.symbolId||bestEntry.externalId||'match'}:${bestEntry.startLine}`:''}`);

    emit({
      action:'GOAL_ENTRY_SELECTION',
      goalId:goal.id,
      strategy:entrySelection.plan.strategy,
      reason:entrySelection.plan.reason,
      searches:entrySelection.plan.searches,
      patterns:entrySelection.plan.patterns,
      candidates:entrySelection.candidates.map(item=>({name:item.name,path:item.sourcePath,start:item.startLine,end:item.endLine,score:item.score,test:item.test}))
    });

    const triaged=entrySelection.plan.strategy==='structured_search'
      ? await triageEntryCandidates({question:searchQuestion,candidates:entrySelection.candidates,client,model,usage,log})
      : entrySelection.candidates;
    const selectedEntries=dedupeStates(triaged.map((candidate)=>{
      if(candidate.symbolId){
        const symbol=explorer.topology.symbolById.get(candidate.symbolId);
        if(!symbol)return null;
        const state=symbolState(symbol);
        const matchRegions=regexMatchRegions(symbol,candidate);
        if(matchRegions.length)state.regexMatchRegions=matchRegions;
        return state;
      }
      if(candidate.externalId){
        const boundary=externalById.get(String(candidate.externalId));
        return boundary?externalBoundaryState(boundary):null;
      }
      return null;
    }).filter(Boolean));

    const selectedIds=new Set(selectedEntries.map(state=>state.id));
    const fallbackEntries=fallbackPool.filter(state=>!selectedIds.has(state.id));
    const hasConcreteStructuralEntries=entrySelection.plan.strategy==='structured_search'&&selectedEntries.length>0;
    thread.entryTiers=hasConcreteStructuralEntries?[selectedEntries]:(selectedEntries.length?[selectedEntries,fallbackEntries]:[fallbackEntries]);
    thread.searched=true;
    console.log(`[query-v5] goal=${goal.id} facetedEntries=${selectedEntries.length} localWindowDepth=${WINDOW_DEPTH}`);
  };

  const seedGoal=async(thread)=>{
    await prepareGoalEntries(thread);
    const goal=thread.goal;
    for(const tier of thread.entryTiers){
      const remaining=tier.filter(state=>!thread.visited.has(state.id)&&!thread.entryTried.has(state.id));
      if(!remaining.length)continue;
      for(let offset=0;offset<remaining.length;offset+=ENTRY_BATCH_SIZE){
        thread.batchNumber+=1;
        const candidates=remaining.slice(offset,offset+ENTRY_BATCH_SIZE);
        for(const candidate of candidates)thread.entryTried.add(candidate.id);

        const windows=[];
        for(const candidate of candidates){
          const learned=await ensureLocalSemanticWindow({state:candidate,path:[],depth:WINDOW_DEPTH,highlightRegions:arr(candidate.regexMatchRegions),includeRootRegions:false,explorer,client,model,usage,log,onProgress:emit});
          recordExplored(arr(learned.window?.states),`entry_window:${goal.id}`,step);
          windows.push(learned.window);
        }

        const decision=await decide({
          question,mode,goals,activeGoalId:goal.id,hypothesis:'',ledger,path:[],
          candidates,candidateWindows:windows,explorer,client,model,usage,log,step:++step,onProgress:emit
        });
        const batchEvent={step,action:'GOAL_ENTRY_BATCH',goalId:goal.id,batch:thread.batchNumber,start:offset,count:candidates.length,bestNavigation:decision.picks[0]?.score||0};
        events.push(batchEvent);emit(batchEvent);

        const warm=decision.picks;
        if(!warm.length)continue;
        thread.stack.push({path:[],current:warm[0],alternatives:warm.slice(1),hypothesis:'',hypothesisScore:0,baseHypothesis:'',baseScore:0,frontierIds:[]});
        const event={step,action:'RESEED',goalId:goal.id,state:warm[0].state.name,hypothesis:''};
        events.push(event);emit({...event,path:[warm[0].state.name]});
        return true;
      }
    }
    thread.exhausted=true;
    return false;
  };

  const resumeThread=async(thread)=>{
    while(thread.stack.length){
      const top=thread.stack.at(-1);

      // A semantic decision may return only the best few candidates even though
      // the parent had a wider frontier. Before abandoning that parent (or
      // switching to one of the parent's siblings), revisit it while any of its
      // previously exposed semantic frontier remains unvisited. The next Query
      // decision will rescore only those remaining candidates.
      const pendingFrontier=arr(top.frontierIds)
        .filter(id=>id&&!thread.visited.has(id));
      if(pendingFrontier.length){
        const event={
          step,action:'SEMANTIC_FRONTIER_REVISIT',goalId:thread.goal.id,
          state:top.current.state.name,remaining:pendingFrontier.length,
          hypothesis:top.hypothesis
        };
        events.push(event);emit({...event,path:[...top.path,top.current.state].map(x=>x.name)});
        return true;
      }

      if(top.alternatives.length){
        top.current=top.alternatives.shift();
        top.frontierIds=[];
        thread.hypothesis=top.baseHypothesis||'';
        thread.hypothesisScore=Number(top.baseScore||0);
        top.hypothesis=thread.hypothesis;
        top.hypothesisScore=thread.hypothesisScore;
        const event={step,action:'BACKTRACK',goalId:thread.goal.id,to:top.current.state.name,hypothesis:thread.hypothesis,hypothesisScore:thread.hypothesisScore,bestScore:thread.bestScore};
        events.push(event);emit({...event,path:[...top.path,top.current.state].map(x=>x.name)});
        return true;
      }
      thread.stack.pop();
      const parent=thread.stack.at(-1);
      thread.hypothesis=parent?.hypothesis||'';
      thread.hypothesisScore=Number(parent?.hypothesisScore||0);
    }
    return seedGoal(thread);
  };

  while(!allGoalsResolved(goals)&&step<MAX_STEPS){
    const candidates=schedulableGoals();
    if(!candidates.length)break;

    const goal=candidates[0];
    const thread=threads.get(goal.id);
    emit({action:'GOAL_ACTIVE',goalId:goal.id,goal:goal.text,kind:goal.kind,goals:goalView(goals)});

    if(!thread.stack.length){
      const seeded=await seedGoal(thread);
      if(!seeded)continue;
    }

    const frame=thread.stack.at(-1);
    const state=frame.current.state;
    thread.visited.add(state.id);

    const learned=await ensureLocalSemanticWindow({
      state,path:frame.path,depth:WINDOW_DEPTH,
      // Learn a bounded semantic lookahead around the current node. Query may
      // inspect these semantics for navigation, but only the visited current
      // node may update the evidence-backed hypothesis.
      highlightRegions:[],
      includeRootRegions:true,includeCallFrontier:true,
      explorer,client,model,usage,log,onProgress:emit
    });
    recordTraversed(state,step);
    recordExplored(arr(learned.window?.states),`semantic_window:${goal.id}`,step);
    const path=[...frame.path,state];

    const regionCandidates=semanticRegionChildren(state,learned.window)
      .filter(region=>!thread.visited.has(region.id));

    // Body-first semantic search. A function or region walks its semantic
    // child regions before the surrounding function may branch to callees.
    // Region nodes themselves never branch to callees; after their semantic
    // subtree is exhausted, control returns to the containing function.
    let next=[];
    let navigationKind='none';
    if(regionCandidates.length){
      next=regionCandidates;
      navigationKind='region';
    }else if(state.type==='code_symbol'){
      next=callChildren(state,explorer,flowChildren).filter(child=>!thread.visited.has(child.id));
      navigationKind='call';
    }

    const lookahead=semanticLookaheadView(next,learned.window,explorer,WINDOW_DEPTH);

    // Preserve the complete semantic frontier on the parent frame. Query may
    // return only the top few navigation picks; the unreturned candidates must
    // remain searchable after those picks are exhausted.
    frame.frontierIds=next.map(candidate=>candidate.id);

    let decision=await decide({
      question,mode,goals,activeGoalId:goal.id,hypothesis:thread.hypothesis||frame.hypothesis,
      ledger,path:frame.path,currentState:state,currentWindow:learned.window,candidates:next,lookahead,
      explorer,client,model,usage,log,step:++step,onProgress:emit
    });

    // Source remains an explicit verification action. The model requests it
    // only when the current visited semantics materially affect the hypothesis
    // but exact code is needed to settle an unresolved hard constraint.
    const sourceAllowed=state.type==='code_region'||state.type==='code_external'||!regionCandidates.length;
    const shouldInspectSource=decision.inspectSource&&sourceAllowed;
    let inspectedSource=false;
    if(shouldInspectSource&&step<MAX_STEPS){
      inspectedSource=true;
      emit({
        action:'SOURCE_INSPECTION',goalId:goal.id,state:state.name,
        sourcePath:state.sourcePath,startLine:state.startLine,endLine:state.endLine,
        path:path.map(x=>x.name)
      });
      decision=await decide({
        question,mode,goals,activeGoalId:goal.id,hypothesis:decision.hypothesis||thread.hypothesis||frame.hypothesis,
        ledger,path:frame.path,currentState:state,currentWindow:learned.window,candidates:next,lookahead,
        sourceBody:String(state.body||state.callText||''),
        explorer,client,model,usage,log,step:++step,onProgress:emit
      });
    }else if(decision.inspectSource&&!sourceAllowed){
      emit({
        action:'SOURCE_DEFERRED',goalId:goal.id,state:state.name,
        reason:'Semantic child regions remain; narrow semantically before source inspection.',
        path:path.map(x=>x.name)
      });
    }

    // Compare the updated accumulated hypothesis with the previous state.
    const previousScore=Number(thread.hypothesisScore||0);
    const progress=hypothesisProgress(previousScore,decision.hypothesisScore);
    thread.hypothesisScore=decision.hypothesisScore;
    thread.flatSteps=progress.trend==='flat'?thread.flatSteps+1:0;
    if(decision.hypothesisScore>thread.bestScore){
      thread.bestScore=decision.hypothesisScore;
      thread.bestHypothesis=decision.hypothesis||thread.hypothesis;
      thread.bestConstraintChecklist=decision.constraintChecklist;
    }
    emit({
      action:'HYPOTHESIS_PROGRESS',goalId:goal.id,
      hypothesis:decision.hypothesis||thread.hypothesis,
      hypothesisScore:decision.hypothesisScore,
      previousScore,delta:progress.delta,trend:progress.trend,
      bestScore:thread.bestScore,constraintChecklist:decision.constraintChecklist,
      path:path.map(x=>x.name),goals:goalView(goals)
    });

    // If Query explicitly finds no useful continuation in the supplied
    // frontier, treat that frontier as exhausted. This prevents a parent from
    // being revisited forever when every remaining candidate scores zero.
    if(!decision.picks.length)frame.frontierIds=[];

    thread.hypothesis=decision.hypothesis||thread.hypothesis;
    // Carry the accumulated assessment back onto the current frame so large
    // function chunks and sibling regions are never evaluated in isolation.
    frame.hypothesis=thread.hypothesis||frame.hypothesis;
    frame.hypothesisScore=thread.hypothesisScore;
    rollingHypothesis=thread.hypothesis||rollingHypothesis;
    applyLedgerDecision({
      ledger,goal,additions:decision.additions,disputes:decision.disputes,
      resolutions:decision.resolutions,supportStates:decision.supportStates,nextFactId
    });

    const activeResolution=decision.goalResolutions.includes(goal.id)?[goal.id]:[];
    const resolvedNow=applyGoalResolutions({
      goals,resolvedIds:activeResolution,supportStates:decision.supportStates
    });
    if(resolvedNow.length){
      if(goal.kind==='locate'){
        addResolvedLocationFact({ledger,goal,state,supportStates:decision.supportStates,nextFactId});
        goal.summary=`${state.name} is the existing implementation identified for ${goal.text}.`;
      }else{
        goal.summary=decision.hypothesis||goal.summary||goal.text;
      }
      thread.stack=[];
      thread.exhausted=true;
      emit({
        action:'GOALS_RESOLVED',goalId:goal.id,resolved:resolvedNow,
        goalScore:decision.activeGoalScore,hypothesisScore:decision.hypothesisScore,goals:goalView(goals),hypothesis:goal.summary
      });
    }

    emit({
      action:'FACTS',goalId:goal.id,facts:ledgerView(ledger,{all:true}),
      goalScore:decision.activeGoalScore,hypothesisScore:decision.hypothesisScore,hypothesis:thread.hypothesis,
      explained:allGoalsResolved(goals),goals:goalView(goals)
    });

    if(allGoalsResolved(goals))break;
    if(goal.status==='resolved')continue;

    const unresolvedHard=new Set(decision.constraintChecklist
      .map((row,index)=>({index,score:Number(row[1]||0),kind:row[2]}))
      .filter(item=>item.kind==='hard'&&item.score<GOAL_CLOSE_SCORE)
      .map(item=>item.index));
    const warm=decision.picks.filter(pick=>{
      const improves=pick.score>thread.bestScore+HYPOTHESIS_DELTA_EPSILON;
      const targetsUnresolved=arr(pick.targets).some(index=>unresolvedHard.has(index));
      const canSpendFlatStep=progress.trend!=='weakening'&&thread.flatSteps<MAX_FLAT_STEPS;
      return improves||(targetsUnresolved&&canSpendFlatStep);
    });
    if(warm.length){
      thread.stack.push({
        path,current:warm[0],alternatives:warm.slice(1),
        hypothesis:thread.hypothesis||decision.hypothesis,hypothesisScore:thread.hypothesisScore,
        baseHypothesis:thread.hypothesis||decision.hypothesis,baseScore:thread.hypothesisScore,
        navigationKind,frontierIds:[]
      });
      const event={
        step,action:'DESCEND',goalId:goal.id,navigationKind,
        from:state.name,to:warm[0].state.name,score:warm[0].score,
        targets:warm[0].targets,hypothesisScore:thread.hypothesisScore,
        hypothesis:decision.hypothesis
      };
      events.push(event);emit({...event,path:[...path,warm[0].state].map(x=>x.name)});
      continue;
    }

    if(decision.picks.length&&!warm.length){
      frame.frontierIds=[];
      emit({
        action:'BRANCH_PRUNED',goalId:goal.id,state:state.name,
        bestScore:thread.bestScore,hypothesisScore:thread.hypothesisScore,
        candidates:decision.picks.map(pick=>({name:pick.state.name,expected:pick.score,targets:pick.targets})),
        path:path.map(x=>x.name)
      });
    }

    // Flat exploration is tolerated briefly only while a branch still appears
    // capable of resolving an unmet hard constraint. Otherwise backtrack and
    // compare alternate branch potential with the best hypothesis seen so far.
    if(thread.flatSteps>=MAX_FLAT_STEPS){
      emit({
        action:'HYPOTHESIS_FLAT',goalId:goal.id,state:state.name,
        hypothesis:thread.hypothesis,hypothesisScore:thread.hypothesisScore,
        bestScore:thread.bestScore,constraintChecklist:decision.constraintChecklist,
        path:path.map(x=>x.name)
      });
    }

    await resumeThread(thread);
  }

  if(allGoalsResolved(goals)){
    finalExplanation=goals.map(goal=>goal.summary).filter(Boolean).join(' ');
    finalEvidence=dedupeStates([...goalEvidenceStates(goals),...ledgerEvidenceStates(ledger)]);
  }

  if(!finalExplanation){
    emit({action:'SEARCH_COMPLETE',explained:false,hypothesis:rollingHypothesis||''});
    log('query_v5_complete',{complete:false,mode,goals:goalView(goals),explained:false,hypothesis:rollingHypothesis||'',facts:ledgerView(ledger,{all:true}),events,usage});
    const diag=diagnostics();log('query_v5_diagnostics',diag);
    const remaining=unresolvedGoals(goals).map(goal=>`${goal.id} ${goal.text}`).join('; ');
    const incompleteAnswer=remaining
      ? `The explored semantic evidence did not yet resolve: ${remaining}`
      : 'The explored semantic evidence did not yet resolve the request.';
    return {answer:incompleteAnswer,mode,goals:goalView(goals),complete:false,explained:false,hypothesis:rollingHypothesis||'',facts:ledgerView(ledger,{all:true}),events,usage,diagnostics:diag,sweExplore:sweExploreView([]),investigation:{mode:'code-flow-goals-v5',reasoningMode:mode,goals:goalView(goals),usage}};
  }

  emit({action:'EXPLAINED',explained:true,hypothesis:finalExplanation});
  // Evidence states already carry exact structural ranges. Do not reopen source
  // merely to localize a conclusion that semantic search has already proved.
  const seenRanges=new Set();
  const ranges=finalEvidence.map(state=>({
    symbolId:state.symbolId||'',
    name:state.name||'',
    sourcePath:state.sourcePath||'',
    startLine:Number(state.startLine||0),
    endLine:Number(state.endLine||state.startLine||0),
    why:text(codeSemanticForState(state,explorer)?.effect||codeSemanticForState(state,explorer)?.purpose||'',260)
  })).filter(range=>{
    if(!range.sourcePath||!range.startLine||range.endLine<range.startLine)return false;
    const key=[range.sourcePath,range.startLine,range.endLine].join(':');
    if(seenRanges.has(key))return false;
    seenRanges.add(key);return true;
  }).map((range,index)=>({...range,rank:index+1}));
  const locations=ranges.map(range=>`${range.sourcePath}#${range.name} ${range.startLine}-${range.endLine}${range.why?' — '+range.why:''}`).join('\n');
  const answer=finalExplanation+(locations?'\n\n'+locations:'');
  log('query_v5_complete',{complete:true,mode,goals:goalView(goals),explained:true,hypothesis:finalExplanation,facts:ledgerView(ledger,{all:true}),ranges,events,usage});
  const diag=diagnostics();log('query_v5_diagnostics',diag);
  return {answer,mode,goals:goalView(goals),complete:true,explained:true,hypothesis:finalExplanation,facts:ledgerView(ledger,{all:true}),ranges,events,usage,diagnostics:diag,sweExplore:sweExploreView(ranges),investigation:{mode:'code-flow-goals-v5',reasoningMode:mode,goals:goalView(goals),usage}};
}
