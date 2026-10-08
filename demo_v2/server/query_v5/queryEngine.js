import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';
import { ensureLocalSemanticWindow, codeSemanticForState } from '../semantics/code/localSemanticLearner.js';
import { selectCodeEntries } from './codeEntrySelector.js';
import { CAUSAL_DECIDE_SYSTEM, GOAL_DECIDE_SYSTEM } from './goalDecisionPrompt.js';
import { causalHypothesisText, evaluateCausalContribution, retainCausalContributions } from './causalEvidence.js';

const MAX_STEPS = 64;
const ENTRY_BATCH_SIZE = 20;
const ENTRY_TRIAGE_LIMIT = 3;
const ENTRY_PER_LOCATOR_LIMIT = 2;
const ENTRY_CONFIRM_CANDIDATE_LIMIT = 8;
const WINDOW_DEPTH = 3;
const GOAL_CLOSE_SCORE = 0.9;
const HYPOTHESIS_DELTA_EPSILON = 0.03;
const MAX_FLAT_STEPS = 2;
const CAUSAL_ACCEPT_SCORE = 0.8;
const GOAL_DECOMPOSE_SYSTEM = `Read the user's software-engineering request as one stable issue that may contain several interdependent obligations. Decompose only the material obligations needed to satisfy the request. A goal kind must be one of "locate", "describe", "causal", "change", or "verify".

Treat these as the primary issue intents:
- causal: the user reports a symptom such as wrong behavior, error, exception, crash, regression, or failing testcase and wants the root cause. Localization, understanding candidate code, and testing a minimal corrective intervention are internal stages of this one causal investigation, not separate goals unless the user explicitly asks for those outputs independently.
- locate: the user explicitly asks where particular existing code or behavior is implemented.
- change: the user explicitly asks to modify existing behavior/code. The investigation must locate the relevant implementation, understand the source-backed behavior at that site, and establish the requested modification against that source.
- describe: the user asks how existing code works or what it does.
- verify: use only when the user explicitly asks to check a separate stated constraint, compatibility requirement, side effect, or consequence.

Do not create locate, describe, change, or verify subgoals merely because a causal investigation internally needs to locate code, understand it, hypothesize a fix, and test whether that fix removes the symptom. Those are stages of causal diagnosis.

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
- failingCase: for causal goals only, a concise literal statement of the reported failing condition/testcase derived only from the original request. Preserve all material discriminators exactly. Do not infer a nearby scenario, mixed-type variant, alternate input, implementation mechanism, or repair. For non-causal goals use "".
Derive these only from the original request and the goal. Do not mention candidate code, implementation mechanisms, filenames, symbols, or source details unless they are explicitly stated in the request itself. These constraints and failingCase are immutable during traversal.

Do not turn rationale, examples, proposed APIs, or incidental wording into separate goals unless the request actually requires them to be established. Keep the set small, normally 1-5 goals and never more than 6. Do not solve the goals. Return {"goals":[{"id":"G1","kind":"causal","text":"","dependsOn":[],"hardConstraints":[],"optionalConstraints":[],"failingCase":""}]} only.`;

const HYPOTHESIS_REPAIR_SYSTEM = `Repair an invalid semantic-walk decision. LeMap detected positive semantic signal but the model returned an empty hypothesis.

q is the original request.
goal is the active goal with immutable hardConstraints and optionalConstraints.
previousH is the branch-local hypothesis before this evidence.
n is the visited semantic evidence.
c is the immediate semantic evidence candidates.
l is bounded semantic lookahead.
f is previously established evidence.

Return the best provisional evidence-backed hypothesis now. It may be incomplete. If previousH exists, keep, refine, weaken, or replace it. If previousH is empty, form one from the visited evidence and the positive direction indicated by the candidates. Do not leave h empty when any supplied semantic signal is positive.

Also return ck, hs and gs using the same meanings as the main semantic-walk contract. This repair step MUST NOT rank or select navigation candidates, request source, add facts, dispute facts, resolve facts, or choose evidence. LeMap owns the original navigation result from the main decision and will preserve it unchanged.

Do not invent source code. Return only:
{"h":"","gs":[],"ck":[],"hs":0.0}.
`;

const ENTRY_TRIAGE_SYSTEM = `Confirm the strongest structural code entry matches for the issue.

q is the issue.
g contains structural search groups as:
[type,value,[[candidateIndex,name,path,context],...]]
Each group is one identifier extracted from the issue.
context is compact:
- function: enclosing function [type,name,row]
- parents: ancestor chain as [type,name,row]
- children: bounded descendant chain as [depth,type,name,row]
- matches: only the exact matched statement neighborhoods, each +/-3 source lines

Compare evidence across ALL groups. The source around the actual match is the strongest last-mile evidence. Parent/child chains are orientation only. Do not let one common identifier dominate because it produced many matches.

Rank and return up to 3 candidate indexes overall that best identify the implementation relevant to the issue.
Use only supplied evidence. Do not infer missing code or proposed implementation.
Return only {"p":[[candidateIndex,score]]}.`;


const CAUSAL_SOURCE_LOCALIZE_SYSTEM = `Locate exact source lines for one completed causal hypothesis.

q is the original issue.
hl is the accepted causal contribution list, in order.
sources are the raw source regions associated with the visited semantic nodes that produced hl.

Select only the smallest exact source ranges that directly support hl.
Every returned range must list the zero-based hl contribution indexes it supports.
Every hl contribution must be supported by at least one returned range.
Do not rewrite, rescore, expand, reject, or repair hl. Do not search outside sources.
Return only:
{"ranges":[{"ref":0,"startLine":0,"endLine":0,"contributionIndexes":[0],"why":""}]}
`;

const EVIDENCE_RESELECT_SYSTEM = `Select the smallest exact source ranges needed to support an already proposed hypothesis against fixed acceptance criteria.

q is the original request.
goal is the active goal.
hard and optional are immutable acceptance criteria.
h is the proposed hypothesis.
src.lines contains LeMap-assigned source evidence candidates as [evidenceIndex,sourceText].
previousEv contains the earlier selected evidence indexes, which were rejected as overly broad.

Do not change, repair, or reinterpret h. Do not search outside src. Select only evidence indexes that materially support h and the acceptance criteria it addresses. Several candidates may be selected and may work together. Omit surrounding, setup, cleanup, unrelated branches, and other candidates that do not contribute. Do not select nearly the whole function unless essentially every candidate is necessary to establish h.

Return ev only as [[evidenceIndex,[constraintIndexes],"why"],...].
Return only {"ev":[]}.`;

const EVIDENCE_GROUND_SYSTEM = `Verify whether the selected source evidence actually grounds an evidence-backed hypothesis against fixed acceptance criteria.

q is the original request.
goal is the active goal.
hard and optional are immutable acceptance criteria.
h is the proposed accumulated hypothesis.
ev is selected exact source evidence as [evidenceIndex,path,startLine,endLine,code,claimedConstraintIndexes,why].

Judge only what the supplied evidence logically establishes. Do not repair the hypothesis, search for a different mechanism, use outside repository knowledge, or give credit merely because related code is nearby.

For every acceptance criterion, return a groundedness score 0..1. A high score means the selected evidence, considered jointly where necessary, materially establishes that criterion in the proposed hypothesis. Several evidence ranges may work together; no single line needs to dominate. If the hypothesis asserts a causal relationship that the selected lines do not actually establish, score that criterion below 0.9 even if the lines mention the same objects.

Also return ok=1 only when every hard criterion is grounded at least 0.9 by the selected evidence set. Return only:
{"ck":[[0,0.0]],"ok":0}.`;

const COUNTERFACTUAL_VALIDATE_SYSTEM = `Validate a proposed causal diagnosis by deriving the smallest hypothetical code change implied by that diagnosis and testing whether that intervention would fix the exact reported failing condition.

q is the original request.
goal is the active causal goal with immutable hard and optional constraints.
failingCase is the frozen failing testcase extracted before repository exploration.
h is the source-grounded causal hypothesis.
ev is the exact selected source evidence as [path,startLine,endLine,code,claimedConstraintIndexes,why].

Do not search for a different cause and do not repair h during this step. Treat h as the diagnosis under test.
Do not derive, rewrite, broaden, narrow, normalize, reinterpret, or substitute failingCase. It is immutable input. If the diagnosis or patch only works for a different testcase, validation fails.

Then:
1. Propose the smallest concrete code change that follows directly from h. The patch may be pseudocode or a minimal before/after snippet, but it must change the operation claimed to be causal rather than an unrelated workaround.
2. Predict beforePrediction for exactly failingCase under the existing code.
3. Predict afterPrediction for exactly the same failingCase after applying the patch.
4. Decide whether the reported functionality changes from failing to correct for the reason claimed by h.
5. If the patch leaves failingCase unchanged, only fixes a different case, requires changing a different mechanism than h identified, or depends on modifying failingCase, validation fails.

For every immutable acceptance criterion, also return ck as [[constraintIndex,score],...] with score 0..1, but score only what the intervention itself logically establishes. Do not raise a criterion merely because the diagnosis already claimed it.

Return pass=1 only when the immutable failingCase fails before, succeeds after, and the change occurs because the intervention neutralizes the claimed mechanism.
When pass=0, failure must state specifically why the intervention does not validate the diagnosis.
Return only:
{"patch":"","beforePrediction":"","afterPrediction":"","ck":[[0,0.0]],"pass":0,"failure":""}.`;

const ANSWER_SYNTHESIS_SYSTEM = `Write the final user-facing answer from an already completed code investigation.

You receive the original request and one or more resolved goal packages. Each package contains the fixed acceptance criteria, the final evidence-backed hypothesis, constraint scores, and exact supporting source ranges.

Your job is presentation only. Explain what the investigation established clearly and concisely. For a causal goal, include the successful counterfactual intervention in the explanation: what minimal change was tested and why the predicted before/after behavior validates the diagnosed mechanism. You may connect the supplied evidence into readable prose, but you must not invent a new mechanism, change the hypothesis, add unsupported repository facts, or cite source outside the supplied evidence. When useful, mention exact files and line ranges. Do not discuss search internals, scores, prompts, or confidence unless the user explicitly asked for them.

Return only {"answer":""}.`;

function symbolState(symbol, parent=null) {
  return { id:symbol.id, type:'code_symbol', name:symbol.name, symbolId:symbol.id, sourcePath:symbol.sourcePath||'', startLine:symbol.startLine||0, endLine:symbol.endLine||0, body:String(symbol.body||''), parent, parentSymbolId:parent };
}

function moduleRegionState(owner,region){
  const kind=String(region?.kind||'region');
  const startLine=Number(region?.startLine||0);
  const sourcePath=String(owner?.sourcePath||'');
  return {
    id:region.id,
    regionId:region.id,
    type:'code_region',
    name:`${sourcePath} [${kind} @ ${startLine}]`,
    symbolId:'',
    sourcePath,
    startLine,
    endLine:Number(region?.endLine||startLine),
    body:String(region?.body||''),
    parent:region?.parentRegionId||null,
    parentSymbolId:null,
    kind,
    moduleLevel:true,
    references:arr(region?.references)
  };
}

function enclosingModuleRegion(topology,sourcePath,line){
  const owner=arr(topology?.moduleRegions)
    .find(item=>String(item?.sourcePath||'')===String(sourcePath||''));
  if(!owner)return null;
  const candidates=arr(owner.regions)
    .filter(region=>Number(region?.startLine||0)<=Number(line||0)&&Number(region?.endLine||region?.startLine||0)>=Number(line||0))
    .sort((a,b)=>
      (Number(a.endLine||0)-Number(a.startLine||0))-(Number(b.endLine||0)-Number(b.startLine||0))
    );
  return candidates.length?moduleRegionState(owner,candidates[0]):null;
}

function fallbackModuleRegions(topology,limit=20){
  const out=[];
  for(const owner of arr(topology?.moduleRegions)){
    for(const region of arr(owner?.regions).filter(region=>!region?.parentRegionId)){
      out.push(moduleRegionState(owner,region));
      if(out.length>=limit)return out;
    }
  }
  return out;
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
  const structuralType=state?.type==='code_region'
    ? String(state?.kind||'region')
    : state?.type==='code_symbol'
      ? 'function'
      : state?.type||'';
  return [structuralType,state?.name||'',text(semantic.purpose||'',320),text(semantic.effect||'',280)];
}

function causalSemanticNodeView(state,explorer){
  const semantic=codeSemanticForState(state,explorer)||{};
  const structuralType=state?.type==='code_region'
    ? String(state?.kind||'region')
    : state?.type==='code_symbol'
      ? 'function'
      : state?.type||'';
  return [structuralType,state?.name||'',text(semantic.purpose||'',180),text(semantic.effect||'',180)];
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

function semanticNavigationChildren(state,window,flowChildren=null){
  const byId=new Map(arr(window?.states).map(item=>[item.id,item]));
  const allowedCalls=flowChildren?.get?.(state?.symbolId)||null;
  const children=arr(window?.links)
    .filter(link=>['contains','calls'].includes(String(link?.relationship||''))&&String(link?.from||'')===String(state?.id||''))
    .map(link=>({relationship:String(link.relationship||''),state:byId.get(link.to)}))
    .filter(item=>item.state&&item.state?.kind!=='regex-match')
    .filter(item=>item.relationship!=='calls'||item.state.type!=='code_symbol'||!allowedCalls||allowedCalls.has(item.state.symbolId))
    .map(item=>({...item.state,navigationRelationship:item.relationship}));
  return dedupeStates(children)
    .sort((a,b)=>{
      const ar=a.type==='code_region'?0:1,br=b.type==='code_region'?0:1;
      return ar-br||Number(a.startLine||0)-Number(b.startLine||0)||String(a.name||'').localeCompare(String(b.name||''));
    });
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

function causalSemanticLookaheadView(candidates=[],window,explorer,maxDepth=3){
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
    return [...causalSemanticNodeView(state,explorer),kids];
  };
  return arr(candidates).map((state,index)=>{
    const descendants=arr(children.get(state.id))
      .map(id=>byId.get(id)).filter(Boolean)
      .map(child=>walk(child,2,new Set([state.id]))).filter(Boolean);
    return [index,descendants];
  }).filter(row=>row[1].length);
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

function ledgerView(ledger,{goals=[],activeGoalId='',branchId='',all=false}={}){
  const dependencies=dependencyGoalIds(goals,activeGoalId);
  return [...ledger.values()]
    .filter(fact=>all||!activeGoalId||fact.goalId===activeGoalId||dependencies.has(fact.goalId))
    .filter(fact=>all||fact.goalKind!=='causal'||!fact.branchId||fact.branchId===branchId)
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

function applyLedgerDecision({ledger,goal,branchId='',additions=[],disputes=[],resolutions=[],supportStates=[],nextFactId}){
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
    ledger.set(id,{id,text:factText,status:'supported',goalId:goal.id,goalKind:goal.kind,branchId:goal.kind==='causal'?String(branchId||''):'',supportStates:boundSupport});
  }
}

function disputeCausalBranchFacts(ledger,goalId,branchId){
  for(const fact of ledger.values()){
    if(fact.goalId===goalId&&fact.goalKind==='causal'&&fact.branchId===branchId){
      fact.status='disputed';
    }
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
    const failingCase=kind==='causal'?text(item.failingCase||goalText,700):'';
    if(!hardConstraints.length)hardConstraints.push(goalText);
    out.push({id,kind,text:goalText,dependsOn:arr(item.dependsOn).map(String),hardConstraints,optionalConstraints,failingCase,status:'unresolved',supportStates:[],summary:''});
  }
  const validIds=new Set(out.map(goal=>goal.id));
  for(const goal of out)goal.dependsOn=goal.dependsOn.filter(id=>id!==goal.id&&validIds.has(id));
  return out.length?out:[{id:'G1',kind:'describe',text:'Answer the software-engineering request from repository evidence.',dependsOn:[],hardConstraints:['The repository evidence answers the requested software-engineering question.'],optionalConstraints:[],failingCase:'',status:'unresolved',supportStates:[],summary:''}];
}

function goalView(goals=[]){
  return arr(goals).map(goal=>[goal.id,goal.kind,goal.status,goal.text,arr(goal.dependsOn),arr(goal.hardConstraints),arr(goal.optionalConstraints),goal.failingCase||'']);
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

function sourceEvidenceCandidates(state,sourceBody){
  if(!state||!sourceBody)return [];
  const start=Number(state.startLine||0);
  return String(sourceBody||'').split(/\r?\n/)
    .map((code,offset)=>({index:offset,line:start+offset,code:String(code||'')}))
    .filter(item=>item.code.trim().length>0);
}

function sourceEvidenceStates(state,sourceBody,evidenceRows=[],sourceCandidates=sourceEvidenceCandidates(state,sourceBody)){
  if(!state||!sourceBody)return [];
  const byIndex=new Map(arr(sourceCandidates).map(item=>[String(item.index),item]));
  const out=[];
  for(const row of arr(evidenceRows).slice(0,24)){
    const candidate=byIndex.get(String(row?.[0]));
    if(!candidate)continue;
    const supports=arr(row?.[1]).map(Number).filter(Number.isInteger);
    out.push({
      ...state,
      id:`${state.id}:evidence:${candidate.line}`,
      name:`${state.name} [evidence ${candidate.line}]`,
      startLine:candidate.line,
      endLine:candidate.line,
      body:candidate.code,
      evidenceIndex:candidate.index,
      evidenceSupports:supports,
      evidenceWhy:text(row?.[2]||'',260)
    });
  }
  return dedupeStates(out);
}

function evidenceCoverageRatio(state,evidenceStates=[]){
  const start=Number(state?.startLine||0),end=Number(state?.endLine||start);
  const total=Math.max(1,end-start+1);
  const covered=new Set();
  for(const item of arr(evidenceStates)){
    const a=Math.max(start,Number(item?.startLine||0));
    const b=Math.min(end,Number(item?.endLine||0));
    for(let line=a;line<=b;line++)covered.add(line);
  }
  return covered.size/total;
}

async function reselectTightEvidence({question,goal,hypothesis,state,sourceBody,sourceCandidates,previousEvidence,client,model,usage,log,step}){
  const payload={
    q:question,
    goal:{id:goal?.id||'',kind:goal?.kind||'',text:goal?.text||''},
    hard:arr(goal?.hardConstraints),
    optional:arr(goal?.optionalConstraints),
    h:hypothesis||'',
    src:{
      name:state?.name||'',
      sourcePath:state?.sourcePath||'',
      lines:arr(sourceCandidates).map(item=>[item.index,text(item.code,360)])
    },
    previousEv:arr(previousEvidence).map(item=>[
      Number(item?.evidenceIndex),
      arr(item?.evidenceSupports),item?.evidenceWhy||''
    ])
  };
  const call=await modelJson(client,model,EVIDENCE_RESELECT_SYSTEM,payload);addUsage(usage,call.usage);
  const states=sourceEvidenceStates(state,sourceBody,call.parsed?.ev,sourceCandidates);
  log('query_v5_evidence_reselect',{step,goalId:goal?.id||'',payload,modelResponse:call.parsed,coverage:evidenceCoverageRatio(state,states),usage:call.usage});
  return states;
}

async function verifyEvidenceGrounding({question,goal,hypothesis,constraints,evidenceStates,client,model,usage,log,step}){
  const evidence=arr(evidenceStates).map((state,index)=>[
    index,
    state.sourcePath||'',
    Number(state.startLine||0),
    Number(state.endLine||state.startLine||0),
    text(state.body||'',1600),
    arr(state.evidenceSupports),
    state.evidenceWhy||''
  ]);
  if(!evidence.length)return {scores:new Map(),ok:false};
  const payload={
    q:question,
    goal:{id:goal?.id||'',kind:goal?.kind||'',text:goal?.text||''},
    hard:arr(goal?.hardConstraints),
    optional:arr(goal?.optionalConstraints),
    h:hypothesis||'',
    ev:evidence
  };
  const call=await modelJson(client,model,EVIDENCE_GROUND_SYSTEM,payload);addUsage(usage,call.usage);
  const scores=new Map();
  for(const row of arr(call.parsed?.ck)){
    const index=Number(row?.[0]);
    if(!Number.isInteger(index)||index<0||index>=constraints.length)continue;
    scores.set(index,Math.max(0,Math.min(1,Number(row?.[1]||0))));
  }
  const ok=Number(call.parsed?.ok||0)===1;
  log('query_v5_evidence_grounding',{step,goalId:goal?.id||'',payload,modelResponse:call.parsed,usage:call.usage});
  return {scores,ok};
}

async function decide({
  question,mode,goals=[],activeGoalId='',branchId='',hypothesis='',hypothesisContributions=[],previousHypothesisScore=0,
  ledger,path=[],currentState=null,
  candidates=[],candidateWindows=[],lookahead=[],sourceBody='',explorer,client,model,usage,log,step,onProgress=()=>{}
}) {
  const entryStage=!currentState;
  const sourceCandidates=sourceBody?sourceEvidenceCandidates(currentState,sourceBody):[];
  const entryMatches=entryStage
    ? candidates.map((state,index)=>({
        index,
        name:state.name,
        matches:arr(candidateWindows[index]?.highlights).flatMap(region=>
          arr(region?.matchedLines).map(match=>[Number(match?.line||0),text(match?.text||'',260),String(match?.pattern||'')])
        )
      })).filter(item=>item.matches.length)
    : [];

  const activeGoal=arr(goals).find(goal=>goal.id===activeGoalId);

  const causal=activeGoal?.kind==='causal';
  const payload=causal
    ? {
        q:question,
        g:[activeGoal?.text||'',activeGoal?.failingCase||''],
        hl:arr(hypothesisContributions).map(item=>item?.claim||'').filter(Boolean),
        ps:Number(previousHypothesisScore||0),
        n:currentState?causalSemanticNodeView(currentState,explorer):null,
        c:candidates.map((state,index)=>[index,...causalSemanticNodeView(state,explorer)]),
        l:entryStage?[]:lookahead
      }
    : {
        q:question,
        g:goalView(goals),
        u:String(activeGoalId||''),
        h:hypothesis||'',
        f:ledgerView(ledger,{goals,activeGoalId,branchId}),
        n:currentState?semanticNodeView(currentState,explorer):null,
        src:sourceBody?{
          name:currentState?.name||'',
          sourcePath:currentState?.sourcePath||'',
          lines:sourceCandidates.map(item=>[item.index,text(item.code,360)])
        }:null,
        m:entryMatches,
        c:candidates.map((state,index)=>[index,...semanticNodeView(state,explorer)]),
        l:entryStage?[]:lookahead
      };

  const decisionPrompt=causal?CAUSAL_DECIDE_SYSTEM:GOAL_DECIDE_SYSTEM;
  let call=await modelJson(client,model,decisionPrompt,payload);addUsage(usage,call.usage);

  if(!entryStage&&!sourceBody&&activeGoal?.kind!=='causal'){
    const parsedP=arr(call.parsed?.p);
    const positiveCandidate=parsedP.some(row=>Number(row?.[1]||0)>0);
    const positiveSemanticSignal=
      positiveCandidate||
      Number(call.parsed?.hs||0)>0||
      arr(call.parsed?.ck).some(row=>Number(row?.[1]||0)>0)||
      arr(call.parsed?.gs).some(row=>Number(row?.[1]||0)>0);
    const missingHypothesis=!String(call.parsed?.h||'').trim();

    if(positiveSemanticSignal&&missingHypothesis){
      log('query_v5_hypothesis_invariant_violation',{
        step,activeGoalId,currentState:currentState?.name||'',
        reason:'positive semantic signal with empty hypothesis',
        modelResponse:call.parsed,
        preservedNavigation:arr(call.parsed?.p)
      });
      const repairPayload={
        q:question,
        goal:{
          id:activeGoal?.id||activeGoalId,
          kind:activeGoal?.kind||'',
          text:activeGoal?.text||'',
          hardConstraints:arr(activeGoal?.hardConstraints),
          optionalConstraints:arr(activeGoal?.optionalConstraints),
          failingCase:activeGoal?.failingCase||''
        },
        previousH:hypothesis||'',
        n:payload.n,
        c:payload.c,
        l:payload.l,
        f:payload.f
      };
      const repaired=await modelJson(client,model,HYPOTHESIS_REPAIR_SYSTEM,repairPayload);
      addUsage(usage,repaired.usage);
      if(String(repaired.parsed?.h||'').trim()){
        const originalParsed=call.parsed||{};
        call={
          ...call,
          parsed:{
            ...originalParsed,
            h:repaired.parsed.h,
            hs:repaired.parsed.hs,
            gs:repaired.parsed.gs,
            ck:repaired.parsed.ck
          },
          usage:{
            prompt:Number(call.usage?.prompt||0)+Number(repaired.usage?.prompt||0),
            completion:Number(call.usage?.completion||0)+Number(repaired.usage?.completion||0),
            total:Number(call.usage?.total||0)+Number(repaired.usage?.total||0)
          }
        };
      }else{
        call={
          ...call,
          parsed:{
            ...call.parsed,
            h:hypothesis||'',
            hs:0,
            gs:[],
            ck:[],
            p:[]
          }
        };
      }
    }
  }

  const byIndex=new Map(candidates.map((state,index)=>[String(index),state]));
  const causalLookaheadIndexes=new Set(
    causal?arr(lookahead).map(row=>String(row?.[0])):[]
  );
  const picks=[];
  for(const row of arr(call.parsed?.p)){
    const index=String(row?.[0]);
    const state=byIndex.get(index);if(!state)continue;
    const score=Math.max(0,Math.min(1,Number(row?.[1]||0)));
    if(!(score>0))continue;
    const targets=entryStage?[]:arr(row?.[2]).map(Number).filter(Number.isInteger);
    picks.push({state,score,targets,hasLookahead:causalLookaheadIndexes.has(index)});
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
  const semanticConstraintScore=hardScores.length
    ? hardScores.reduce((sum,value)=>sum+value,0)/hardScores.length
    : 0;
  // During semantic traversal, hs is the branch-local explanatory strength.
  // Constraint scores remain diagnostics until exact source is inspected.
  // Once source is present, grounded hard-constraint scores become authoritative.
  const hypothesisScore=!entryStage&&activeGoal?.kind==='causal'
    ? modelHypothesisScore
    : sourceBody
      ? (semanticConstraintScore||modelHypothesisScore||activeGoalScore)
      : (modelHypothesisScore||semanticConstraintScore||activeGoalScore);
  const hardConstraintsMet=!entryStage&&Boolean(sourceBody)&&hardScores.length>0&&hardScores.every(score=>score>=GOAL_CLOSE_SCORE);
  // Goal closure is anchored in the accumulated hypothesis satisfying every
  // hard acceptance constraint. gs remains a model diagnostic, not the sole
  // convergence switch.
  const inspectSource=!entryStage&&!sourceBody&&Number(call.parsed?.i||0)===1;
  let evidenceStates=!entryStage&&sourceBody
    ? sourceEvidenceStates(currentState,sourceBody,call.parsed?.ev,sourceCandidates)
    : [];
  let evidenceReselected=false;
  if(!entryStage&&sourceBody&&evidenceStates.length&&activeGoal?.kind!=='causal'){
    const functionLines=Math.max(1,Number(currentState?.endLine||0)-Number(currentState?.startLine||0)+1);
    const coverage=evidenceCoverageRatio(currentState,evidenceStates);
    if(functionLines>=8&&coverage>=0.8){
      const tighter=await reselectTightEvidence({
        question,goal:activeGoal,hypothesis:text(call.parsed?.h||hypothesis||'',900),
        state:currentState,sourceBody,sourceCandidates,previousEvidence:evidenceStates,
        client,model,usage,log,step
      });
      if(tighter.length){
        evidenceStates=tighter;
        evidenceReselected=true;
      }
    }
  }
  let grounding=null;
  if(!entryStage&&sourceBody&&activeGoal?.kind!=='causal'){
    if(evidenceStates.length){
      grounding=await verifyEvidenceGrounding({
        question,goal:activeGoal,hypothesis:text(call.parsed?.h||hypothesis||'',900),
        constraints:fixedConstraints,evidenceStates,client,model,usage,log,step
      });
      for(const item of fixedConstraints){
        const current=Number(scoreByIndex.get(item.index)||0);
        const grounded=grounding.scores.has(item.index)?Number(grounding.scores.get(item.index)||0):0;
        scoreByIndex.set(item.index,Math.min(current,grounded));
      }
    }else{
      grounding={scores:new Map(),ok:false};
      for(const item of fixedConstraints)scoreByIndex.set(item.index,0);
    }
  }
  const groundedConstraintChecklist=!entryStage
    ? fixedConstraints.map(item=>[item.text,Number(scoreByIndex.get(item.index)||0),item.kind])
    : [];
  const groundedHardScores=groundedConstraintChecklist.filter(row=>row[2]==='hard').map(row=>Number(row[1]||0));
  const proposedCausalContribution=activeGoal?.kind==='causal'
    ? String(call.parsed?.hc||'').trim()
    : '';
  const groundedHypothesisScore=activeGoal?.kind==='causal'
    ? modelHypothesisScore
    : sourceBody&&groundedHardScores.length
      ? groundedHardScores.reduce((sum,value)=>sum+value,0)/groundedHardScores.length
      : hypothesisScore;
  const groundedHardConstraintsMet=!entryStage&&Boolean(sourceBody)&&activeGoal?.kind!=='causal'&&groundedHardScores.length>0&&groundedHardScores.every(score=>score>=GOAL_CLOSE_SCORE);
  const evidenceRanges=evidenceStates.map(item=>({
    sourcePath:item.sourcePath||'',
    startLine:Number(item.startLine||0),
    endLine:Number(item.endLine||item.startLine||0),
    evidenceIndex:Number(item.evidenceIndex),
    supports:arr(item.evidenceSupports),
    why:item.evidenceWhy||''
  }));
  const unresolvedOther=arr(goals).some(goal=>goal.id!==activeGoalId&&goal.status!=='resolved');
  const assessment=sourceBody&&['confirm','revise','reject'].includes(String(call.parsed?.assessment||'').toLowerCase())
    ?String(call.parsed.assessment).toLowerCase():'';
  const currentContribution=entryStage?'':text(call.parsed?.hc||'',700);
  const evidenceRelevance=!entryStage&&activeGoal?.kind==='causal'
    ? (Number(call.parsed?.er||0)===1?1:0)
    : 0;
  const requestedKeepIndexes=activeGoal?.kind==='causal'
    ? arr(call.parsed?.k).map(Number).filter(Number.isInteger)
    : [];
  const retainedContributionIndexes=activeGoal?.kind==='causal'
    ? (Array.isArray(call.parsed?.k)
        ? [...new Set(requestedKeepIndexes.filter(index=>index>=0&&index<arr(hypothesisContributions).length))]
        : arr(hypothesisContributions).map((_,index)=>index))
    : [];
  const retainedContributions=activeGoal?.kind==='causal'
    ? retainCausalContributions(hypothesisContributions,retainedContributionIndexes)
    : [];
  const causalDisplayHypothesis=activeGoal?.kind==='causal'
    ? causalHypothesisText([
        ...retainedContributions,
        ...(currentContribution?[{claim:currentContribution}]:[])
      ])
    : '';

  const result={
    explained:groundedHardConstraintsMet&&!unresolvedOther,
    assessment,
    evidenceRelevance,
    contribution:currentContribution,
    retainedContributionIndexes,
    causalHypothesisComplete:!entryStage&&activeGoal?.kind==='causal'&&Number(call.parsed?.cx||0)===1,
    hypothesis:entryStage?'':activeGoal?.kind==='causal'?causalDisplayHypothesis:text(call.parsed?.h||hypothesis||'',900),
    picks,
    additions:entryStage?[]:arr(call.parsed?.a),
    disputes:entryStage?[]:arr(call.parsed?.d),
    resolutions:entryStage?[]:arr(call.parsed?.r),
    goalResolutions:groundedHardConstraintsMet?[String(activeGoalId)]:[],
    goalScores:[...goalScores.entries()],
    activeGoalScore,
    hypothesisScore:groundedHypothesisScore,
    hardConstraintsMet:groundedHardConstraintsMet,
    constraintChecklist:groundedConstraintChecklist,
    inspectSource,
    evidenceRanges,
    evidenceGrounded:activeGoal?.kind==='causal'?null:(grounding?grounding.ok:null),
    causalMechanismGrounded:null,
    causalMechanismScore:null,
    causalMechanismWhy:null,
    evidenceReselected,
    evidenceCoverage:sourceBody?evidenceCoverageRatio(currentState,evidenceStates):0,
    supportStates:evidenceStates.length?evidenceStates:(currentState?[currentState]:[])
  };

  log('query_v5_decision',{step,mode,payload,modelResponse:call.parsed,result:{
    explained:result.explained,assessment:result.assessment,evidenceRelevance:result.evidenceRelevance,hypothesis:result.hypothesis,contribution:result.contribution,retainedContributionIndexes:result.retainedContributionIndexes,causalHypothesisComplete:result.causalHypothesisComplete,
    picks:picks.map(x=>({name:x.state.name,score:x.score})),
    goalScores:result.goalScores,hypothesisScore:result.hypothesisScore,hardConstraintsMet:result.hardConstraintsMet,constraintChecklist:result.constraintChecklist,inspectSource:result.inspectSource,
    evidenceRanges:result.evidenceRanges,evidenceGrounded:result.evidenceGrounded,causalMechanismGrounded:result.causalMechanismGrounded,causalMechanismScore:result.causalMechanismScore,evidenceReselected:result.evidenceReselected,evidenceCoverage:result.evidenceCoverage,
    additions:result.additions,disputes:result.disputes,resolutions:result.resolutions,
    goalResolutions:result.goalResolutions
  },usage:call.usage});

  const displayPath=currentState?[...path,currentState]:path;
  onProgress({
    action:'DECIDE',step,mode,assessment:result.assessment,evidenceRelevance:result.evidenceRelevance,hypothesis:result.hypothesis,contribution:result.contribution,retainedContributionIndexes:result.retainedContributionIndexes,causalHypothesisComplete:result.causalHypothesisComplete,explained:result.explained,
    goalScores:result.goalScores,hypothesisScore:result.hypothesisScore,hardConstraintsMet:result.hardConstraintsMet,constraintChecklist:result.constraintChecklist,inspectSource:result.inspectSource,evidenceRanges:result.evidenceRanges,evidenceGrounded:result.evidenceGrounded,causalMechanismGrounded:result.causalMechanismGrounded,causalMechanismScore:result.causalMechanismScore,evidenceReselected:result.evidenceReselected,evidenceCoverage:result.evidenceCoverage,goals:goalView(goals),
    path:displayPath.map(x=>x.name),facts:ledgerView(ledger,{all:true}),
    candidates:picks.map(x=>({id:x.state.id,name:x.state.name,navigation:x.score,targets:x.targets,stage:entryStage?'entry':'semantic'}))
  });
  return result;
}

async function validateCausalCounterfactual({question,goal,hypothesis,evidenceStates,client,model,usage,log,step}){
  const evidence=dedupeStates(evidenceStates).map(state=>[
    state.sourcePath||'',
    Number(state.startLine||0),
    Number(state.endLine||state.startLine||0),
    text(state.body||'',1200),
    arr(state.evidenceSupports),
    state.evidenceWhy||''
  ]);
  if(!hypothesis||!evidence.length){
    return {pass:false,failingCase:'',patch:'',beforePrediction:'',afterPrediction:'',prediction:'',constraintScores:[],failure:'Counterfactual validation could not run because the causal hypothesis has no exact supporting source evidence.'};
  }
  const payload={
    q:question,
    goal:{
      id:goal?.id||'',text:goal?.text||'',
      hard:arr(goal?.hardConstraints),optional:arr(goal?.optionalConstraints)
    },
    failingCase:goal?.failingCase||'',
    h:hypothesis,
    ev:evidence
  };
  const call=await modelJson(client,model,COUNTERFACTUAL_VALIDATE_SYSTEM,payload);addUsage(usage,call.usage);
  const result={
    pass:Number(call.parsed?.pass||0)===1,
    failingCase:text(goal?.failingCase||'',1800),
    patch:text(call.parsed?.patch||'',2200),
    beforePrediction:text(call.parsed?.beforePrediction||'',1600),
    afterPrediction:text(call.parsed?.afterPrediction||'',1600),
    prediction:'',
    constraintScores:arr(call.parsed?.ck).map(row=>[
      Number(row?.[0]),Math.max(0,Math.min(1,Number(row?.[1]||0)))
    ]).filter(row=>Number.isInteger(row[0])&&row[0]>=0),
    failure:text(call.parsed?.failure||'',1600)
  };
  result.prediction=[result.beforePrediction&&`before: ${result.beforePrediction}`,result.afterPrediction&&`after: ${result.afterPrediction}`].filter(Boolean).join(' | ');
  // The validator must expose the immutable testcase and a true before/after
  // comparison. A pass without those artifacts is structurally invalid.
  if(result.pass&&(!result.failingCase||!result.beforePrediction||!result.afterPrediction)){
    result.pass=false;
    result.failure='Counterfactual validation did not test the frozen failing case with both before and after predictions.';
  }
  if(!result.pass&&!result.failure)result.failure='The proposed intervention did not establish that the diagnosed mechanism fixes the exact reported failing condition.';
  log('query_v5_counterfactual_validation',{step,goalId:goal?.id||'',payload,result,usage:call.usage});
  return result;
}

async function synthesizeResolvedAnswer({question,goals,threads,client,model,usage,log}){
  const packages=goals.map(goal=>{
    const thread=threads.get(goal.id);
    const evidence=dedupeStates(goal.supportStates||[]).map(state=>({
      path:state.sourcePath||'',
      startLine:Number(state.startLine||0),
      endLine:Number(state.endLine||state.startLine||0),
      code:text(state.body||'',1800),
      supports:arr(state.evidenceSupports),
      why:state.evidenceWhy||''
    }));
    return {
      id:goal.id,kind:goal.kind,text:goal.text,failingCase:goal.failingCase||'',
      hardConstraints:arr(goal.hardConstraints),
      optionalConstraints:arr(goal.optionalConstraints),
      hypothesis:goal.summary||thread?.bestHypothesis||thread?.hypothesis||'',
      hypothesisScore:Number(thread?.hypothesisScore||thread?.bestScore||0),
      constraintScores:arr(thread?.bestConstraintChecklist).map(row=>({text:row[0],score:Number(row[1]||0),kind:row[2]})),
      counterfactualValidation:thread?.counterfactualValidation||null,
      evidence
    };
  });
  const call=await modelJson(client,model,ANSWER_SYNTHESIS_SYSTEM,{q:question,goals:packages});addUsage(usage,call.usage);
  const answer=text(call.parsed?.answer||'',5000);
  log('query_v5_answer_synthesis',{question,goals:packages,answer,usage:call.usage});
  return answer;
}

async function localizeCausalHypothesis({question,hypothesisContributions,evidenceStates,client,model,usage,log}){
  const states=dedupeStates(evidenceStates);
  const sources=states.map((state,ref)=>({
    ref,
    name:state.name,
    sourcePath:state.sourcePath,
    startLine:Number(state.startLine||0),
    endLine:Number(state.endLine||state.startLine||0),
    body:text(state.body,3200)
  }));
  const hl=arr(hypothesisContributions).map(item=>item?.claim||'').filter(Boolean);
  const call=await modelJson(client,model,CAUSAL_SOURCE_LOCALIZE_SYSTEM,{q:question,hl,sources});addUsage(usage,call.usage);
  const ranges=[];
  for(const item of arr(call.parsed?.ranges)){
    const source=sources[Number(item?.ref)];if(!source)continue;
    const contributionIndexes=arr(item?.contributionIndexes)
      .map(Number)
      .filter(index=>Number.isInteger(index)&&index>=0&&index<hl.length);
    ranges.push({
      name:source.name,
      sourcePath:source.sourcePath,
      startLine:Number(item?.startLine||source.startLine||0),
      endLine:Number(item?.endLine||source.endLine||0),
      contributionIndexes:[...new Set(contributionIndexes)],
      why:text(item?.why||'',260)
    });
  }
  log('query_v5_causal_source_localize',{hl,ranges,usage:call.usage});
  return ranges;
}

function localizedRangeStates(evidenceStates=[],ranges=[]){
  const states=dedupeStates(evidenceStates);
  const out=[];
  for(const range of arr(ranges)){
    const source=states.find(state=>
      String(state?.sourcePath||'')===String(range?.sourcePath||'')&&
      Number(state?.startLine||0)<=Number(range?.startLine||0)&&
      Number(state?.endLine||state?.startLine||0)>=Number(range?.endLine||range?.startLine||0)
    );
    if(!source)continue;
    const sourceStart=Number(source.startLine||0);
    const start=Number(range.startLine||sourceStart);
    const end=Number(range.endLine||start);
    const lines=String(source.body||'').split(/\r?\n/);
    const offset=Math.max(0,start-sourceStart);
    const count=Math.max(1,end-start+1);
    out.push({
      ...source,
      id:`${source.id}:localized:${start}-${end}`,
      name:`${source.name} [evidence ${start}-${end}]`,
      startLine:start,
      endLine:end,
      body:lines.slice(offset,offset+count).join('\n'),
      evidenceSupports:arr(range.contributionIndexes),
      evidenceWhy:range.why||''
    });
  }
  return dedupeStates(out);
}

function causalSourceCoverageComplete(ranges=[],contributionCount=0){
  if(!(contributionCount>0))return false;
  const covered=new Set(
    arr(ranges).flatMap(range=>arr(range?.contributionIndexes))
      .map(Number)
      .filter(index=>Number.isInteger(index)&&index>=0&&index<contributionCount)
  );
  for(let index=0;index<contributionCount;index+=1){
    if(!covered.has(index))return false;
  }
  return true;
}

function causalVisitSignature(contributions=[]){
  return arr(contributions)
    .map(item=>String(item?.claim||'').trim().toLowerCase())
    .filter(Boolean)
    .join('\u241f');
}

function semanticVisitKey(stateOrId,goalKind,contributions=[]){
  const id=typeof stateOrId==='string'?stateOrId:String(stateOrId?.id||'');
  if(String(goalKind||'')!=='causal')return id;
  return `${id}|hl:${causalVisitSignature(contributions)}`;
}

async function triageEntryCandidates({question,candidates=[],client,model,usage,log}){
  const source=arr(candidates);
  if(source.length<=1)return source.slice(0,ENTRY_TRIAGE_LIMIT);

  const candidateKey=(candidate)=>String(
    candidate?.symbolId||
    candidate?.externalId||
    `${candidate?.sourcePath||''}:${Number(candidate?.startLine||0)}:${candidate?.name||''}`
  );

  const locatorGroups=new Map();
  for(const candidate of source){
    const patterns=[...new Set(arr(candidate?.matches)
      .map(match=>String(match?.pattern||''))
      .filter(Boolean))];
    for(const pattern of (patterns.length?patterns:['*:*'])){
      if(!locatorGroups.has(pattern))locatorGroups.set(pattern,[]);
      locatorGroups.get(pattern).push(candidate);
    }
  }

  const candidateScore=(candidate)=>Math.max(
    Number(candidate?.score||0),
    Number(candidate?.structuredScore||0),
    Number(candidate?.entryRankScore||0)
  );

  // Preserve locator diversity deterministically before asking the model:
  // at most 2 strongest candidates for each (type,value), deduped by enclosing
  // function/boundary, then at most 8 candidates total.
  const shortlist=[];
  const shortlistedKeys=new Set();
  for(const [,groupCandidates] of locatorGroups){
    const strongest=[...groupCandidates]
      .sort((a,b)=>candidateScore(b)-candidateScore(a))
      .slice(0,ENTRY_PER_LOCATOR_LIMIT);
    for(const candidate of strongest){
      const key=candidateKey(candidate);
      if(shortlistedKeys.has(key))continue;
      shortlistedKeys.add(key);
      shortlist.push(candidate);
      if(shortlist.length>=ENTRY_CONFIRM_CANDIDATE_LIMIT)break;
    }
    if(shortlist.length>=ENTRY_CONFIRM_CANDIDATE_LIMIT)break;
  }

  if(!shortlist.length)return source.slice(0,ENTRY_TRIAGE_LIMIT);

  const indexByKey=new Map(shortlist.map((candidate,index)=>[candidateKey(candidate),index]));
  const candidateRows=shortlist.map((candidate,index)=>{
    const ctx=candidate?.entryContext||{};
    return [
      index,
      candidate?.name||candidate?.symbolName||candidate?.externalName||'',
      candidate?.sourcePath||'',
      {
        function:arr(ctx?.function).slice(0,3),
        parents:arr(ctx?.parents).slice(0,8),
        children:arr(ctx?.children).slice(0,12),
        matches:arr(ctx?.matches).slice(0,3).map(match=>[
          match?.locator||'',
          match?.type||'',
          match?.name||'',
          Number(match?.line||0),
          arr(match?.lines).slice(0,7)
        ])
      }
    ];
  });

  const grouped=[...locatorGroups.entries()].map(([key,groupCandidates])=>{
    const split=key.indexOf(':');
    const type=split>=0?key.slice(0,split):'*';
    const value=split>=0?key.slice(split+1):key;
    const rows=[];
    for(const candidate of [...groupCandidates].sort((a,b)=>candidateScore(b)-candidateScore(a))){
      const index=indexByKey.get(candidateKey(candidate));
      if(index===undefined)continue;
      rows.push(candidateRows[index]);
      if(rows.length>=ENTRY_PER_LOCATOR_LIMIT)break;
    }
    return [type||'*',value||'',rows];
  }).filter(group=>group[2].length);

  if(shortlist.length<=1)return shortlist.slice(0,ENTRY_TRIAGE_LIMIT);

  const call=await modelJson(client,model,ENTRY_TRIAGE_SYSTEM,{q:question,g:grouped});
  addUsage(usage,call.usage);

  const byIndex=new Map(shortlist.map((candidate,index)=>[String(index),candidate]));
  const ranked=[];
  const seen=new Set();
  for(const row of arr(call.parsed?.p)){
    const index=String(row?.[0]);
    if(seen.has(index))continue;
    const candidate=byIndex.get(index);
    if(!candidate)continue;
    seen.add(index);
    const score=Math.max(0,Math.min(1,Number(row?.[1]||0)));
    ranked.push({candidate:{...candidate,entryRankScore:score},score});
  }
  ranked.sort((a,b)=>b.score-a.score);
  const selected=ranked.slice(0,ENTRY_TRIAGE_LIMIT).map(item=>item.candidate);
  const fallback=selected.length?selected:shortlist.slice(0,ENTRY_TRIAGE_LIMIT);

  log('query_v5_entry_triage',{
    perLocatorLimit:ENTRY_PER_LOCATOR_LIMIT,
    confirmationCandidateLimit:ENTRY_CONFIRM_CANDIDATE_LIMIT,
    groups:grouped.map(group=>({type:group[0],value:group[1],candidateCount:group[2].length})),
    sourceCandidateCount:source.length,
    confirmationCandidateCount:shortlist.length,
    selected:fallback.map(candidate=>({
      name:candidate?.name||candidate?.symbolName||candidate?.externalName||'',
      sourcePath:candidate?.sourcePath||'',
      startLine:Number(candidate?.startLine||0),
      entryRankScore:Number(candidate?.entryRankScore||0),
      matches:arr(candidate?.matches).slice(0,4)
    })),
    usage:call.usage
  });
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
  const hasExecutableTopology=
    Number(explorer.topology?.symbolById?.size||0)>0 ||
    arr(explorer.topology?.moduleRegions).some(item=>arr(item?.regions).length>0);
  const localTopologyReady=sameRepo&&!revisionMismatch
    &&Array.isArray(explorer.topology?.codeStructureRows)&&explorer.topology.codeStructureRows.length>0
    &&hasExecutableTopology;

  if(!localTopologyReady){
    explorer.topology.targetCommit=requestedCommit;
    const prepareStarted=Date.now();
    console.log(`[query-v5] preparing query-local topology repo=${wanted} revision=${requestedCommit||'HEAD'}`);
    emit({action:'PREPARE_TOPOLOGY',mode:'',detail:'Hydrating structural index and local AST call graph for Query.'});
    const preparedResult=typeof explorer.topology?.prepareCodeQuery==='function'
      ? await explorer.topology.prepareCodeQuery(wanted)
      : await explorer.topology.prepare(wanted);
    console.log(`[query-v5] query-local topology ready ${Date.now()-prepareStarted}ms globalCallPaths=${preparedResult?.codeQueryTopology?'skipped':'prepared'}`);
    emit({action:'TOPOLOGY_READY',mode:'',detail:'Structural query topology ready. Starting structural CSV entry selection.'});
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
  const moduleEntries=fallbackModuleRegions(explorer.topology,20);
  const fallbackPool=[...fallbackRoots,...moduleEntries,...externalEntries];
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
    entryVisited:new Map(),
    entryTried:new Set(),
    stack:[],
    batchNumber:0,
    hypothesis:'',
    hypothesisScore:0,
    hypothesisContributions:[],
    bestHypothesis:'',
    bestHypothesisContributions:[],
    bestScore:0,
    bestConstraintChecklist:[],
    bestSupportStates:[],
    counterfactualValidation:null,
    sourceLocalizationByHypothesis:new Map(),
    entryScores:new Map(),
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

    emit({
      action:'GOAL_SEARCH',
      goalId:goal.id,
      goal:goal.text,
      kind:goal.kind,
      query:searchQuestion
    });

    // The new entry path is deliberately direct:
    // goal-aware issue text -> tiny construct extractor -> PAL FILTER -> local-code confirmation.
    const entrySelection=await selectCodeEntries({
      question:searchQuestion,
      mode:goal.kind,
      topology:explorer.topology,
      client,model,usage,log
    });
    thread.entrySelection=entrySelection;
    const bestEntry=entrySelection.candidates[0];
    const searchCount=entrySelection.plan.strategy==='structured_search'
      ? entrySelection.plan.searches.length
      : entrySelection.plan.patterns.length;
    console.log(`[goal-entry-search] goal=${goal.id} ${entrySelection.plan.strategy} searches=${searchCount} hits=${entrySelection.hits.length} candidates=${entrySelection.candidates.length}${bestEntry?` best=${bestEntry.sourcePath}#${bestEntry.name||bestEntry.symbolId||bestEntry.externalId||'match'}:${bestEntry.startLine}`:''}`);

    const triaged=entrySelection.plan.strategy==='structured_search'
      ? await triageEntryCandidates({question:searchQuestion,candidates:entrySelection.candidates,client,model,usage,log})
      : entrySelection.candidates.slice(0,ENTRY_TRIAGE_LIMIT);

    const selectedEntries=dedupeStates(triaged.slice(0,ENTRY_TRIAGE_LIMIT).map((candidate)=>{
      if(candidate.symbolId){
        const symbol=explorer.topology.symbolById.get(candidate.symbolId);
        if(!symbol)return null;
        const state=symbolState(symbol);
        state.entryRankScore=Number(candidate.entryRankScore||candidate.score||0);
        const matchRegions=regexMatchRegions(symbol,candidate);
        if(matchRegions.length)state.regexMatchRegions=matchRegions;
        return state;
      }
      if(candidate.externalId){
        const boundary=externalById.get(String(candidate.externalId));
        if(!boundary)return null;
        const state=externalBoundaryState(boundary);
        state.entryRankScore=Number(candidate.entryRankScore||candidate.score||0);
        return state;
      }
      const moduleRegion=enclosingModuleRegion(
        explorer.topology,
        candidate.sourcePath||candidate?.metadata?.file||'',
        Number(candidate.startLine||String(candidate?.metadata?.line_range||'').split('-')[0]||0)
      );
      if(moduleRegion){
        moduleRegion.entryRankScore=Number(candidate.entryRankScore||candidate.score||0);
        return moduleRegion;
      }
      return null;
    }).filter(Boolean));

    emit({
      action:'GOAL_ENTRY_SELECTION',
      goalId:goal.id,
      strategy:entrySelection.plan.strategy,
      reason:entrySelection.plan.reason,
      searches:entrySelection.plan.searches,
      patterns:entrySelection.plan.patterns,
      candidates:selectedEntries.map(item=>({
        name:item.name,path:item.sourcePath,start:item.startLine,end:item.endLine,
        entryRankScore:Number(item.entryRankScore||0)
      }))
    });

    // PAL/local confirmation owns entry selection. Semantic exploration starts
    // from these top three entries directly. Fall back to generic roots only
    // when structural localization produced no usable entry.
    thread.entryTiers=selectedEntries.length?[selectedEntries]:[fallbackPool];
    thread.searched=true;
    console.log(`[query-v5] goal=${goal.id} palEntries=${selectedEntries.length} localWindowDepth=${WINDOW_DEPTH}`);
  };

  const seedGoal=async(thread)=>{
    await prepareGoalEntries(thread);
    const goal=thread.goal;

    for(const tier of thread.entryTiers){
      const candidates=tier
        .filter(state=>!thread.entryTried.has(state.id))
        .slice(0,ENTRY_TRIAGE_LIMIT);
      if(!candidates.length)continue;

      thread.batchNumber+=1;
      for(const candidate of candidates)thread.entryTried.add(candidate.id);

      // No second semantic "entry ranking" pass here. PAL + bounded source
      // confirmation already produced the entry order. Semantic reasoning now
      // begins only after an entry is actually visited, so hypothesis updates
      // remain evidence-backed.
      const ranked=candidates.map((state,index)=>({
        state,
        score:Math.max(0.25,Number(state.entryRankScore||0),1-(index*0.15)),
        targets:[]
      }));

      thread.stack.push({
        path:[],
        current:ranked[0],
        alternatives:ranked.slice(1),
        hypothesis:'',
        hypothesisScore:0,
        hypothesisContributions:[],
        baseHypothesis:'',
        baseScore:0,
        baseHypothesisContributions:[],
        flatSteps:0,
        baseFlatSteps:0,
        frontierIds:[],
        entryRootId:ranked[0].state.id,
        entryRootName:ranked[0].state.name
      });

      const event={
        step,
        action:'RESEED',
        goalId:goal.id,
        state:ranked[0].state.name,
        hypothesis:'',
        entries:ranked.map((item,index)=>({
          rank:index+1,
          name:item.state.name,
          path:item.state.sourcePath||'',
          structuralScore:Number(item.state.entryRankScore||0)
        }))
      };
      events.push(event);
      emit({...event,path:[ranked[0].state.name]});
      return true;
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
      const activeVisited=thread.entryVisited.get(top.entryRootId)||new Set();
      const pendingFrontier=arr(top.frontierIds)
        .filter(id=>id&&!activeVisited.has(
          semanticVisitKey(id,thread.goal.kind,thread.hypothesisContributions)
        ));
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
        if(top.path.length===0){
          // Each top-level entry is an independent causal hypothesis branch.
          top.entryRootId=top.current.state.id;
          top.entryRootName=top.current.state.name;
          thread.hypothesis='';
          thread.hypothesisScore=0;
          thread.hypothesisContributions=[];
          thread.flatSteps=0;
          top.flatSteps=0;
          top.baseFlatSteps=0;
        }else{
          // A sibling semantic branch restarts from the causal state at its
          // parent. Evidence collected only on the abandoned sibling is not
          // carried across.
          thread.hypothesis=top.baseHypothesis||'';
          thread.hypothesisScore=Number(top.baseScore||0);
          thread.hypothesisContributions=arr(top.baseHypothesisContributions).map(item=>({...item,supportStates:arr(item?.supportStates)}));
          thread.flatSteps=Number(top.baseFlatSteps||0);
          top.flatSteps=thread.flatSteps;
        }
        top.hypothesis=thread.hypothesis;
        top.hypothesisScore=thread.hypothesisScore;
        top.hypothesisContributions=arr(thread.hypothesisContributions);
        const event={step,action:'BACKTRACK',goalId:thread.goal.id,to:top.current.state.name,hypothesis:thread.hypothesis,hypothesisScore:thread.hypothesisScore,bestScore:thread.bestScore};
        events.push(event);emit({...event,path:[...top.path,top.current.state].map(x=>x.name)});
        return true;
      }
      thread.stack.pop();
      const parent=thread.stack.at(-1);
      thread.hypothesis=parent?.hypothesis||'';
      thread.hypothesisScore=Number(parent?.hypothesisScore||0);
      thread.hypothesisContributions=arr(parent?.hypothesisContributions).map(item=>({...item,supportStates:arr(item?.supportStates)}));
      thread.flatSteps=Number(parent?.flatSteps||0);
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
    const entryRootId=frame.entryRootId||state.id;
    const entryRootName=frame.entryRootName||state.name;
    let entryVisited=thread.entryVisited.get(entryRootId);
    if(!entryVisited){
      entryVisited=new Set();
      thread.entryVisited.set(entryRootId,entryVisited);
    }
    entryVisited.add(semanticVisitKey(state,goal.kind,thread.hypothesisContributions));
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

    // Functions and regions use the same semantic navigation rule. The current
    // causal node gets a LOCAL evidence relevance score, but navigation is
    // driven by whether adding evidence along a candidate is expected to
    // strengthen, flatten, or weaken the OVERALL accumulated hypothesis.
    const next=semanticNavigationChildren(state,learned.window,flowChildren)
      .filter(child=>!entryVisited.has(
        semanticVisitKey(child,goal.kind,thread.hypothesisContributions)
      ));
    const regionCandidates=next.filter(child=>child.type==='code_region');
    const navigationKind=next.length
      ? (regionCandidates.length===next.length?'region':regionCandidates.length?'mixed':'call')
      : 'none';

    const lookahead=goal.kind==='causal'
      ? causalSemanticLookaheadView(next,learned.window,explorer,WINDOW_DEPTH)
      : semanticLookaheadView(next,learned.window,explorer,WINDOW_DEPTH);

    // Preserve the complete semantic frontier on the parent frame. Query may
    // return only the top few navigation picks; the unreturned candidates must
    // remain searchable after those picks are exhausted.
    frame.frontierIds=next.map(candidate=>candidate.id);

    let decision=await decide({
      question,mode,goals,activeGoalId:goal.id,branchId:entryRootId,hypothesis:thread.hypothesis||frame.hypothesis,
      hypothesisContributions:thread.hypothesisContributions,previousHypothesisScore:thread.hypothesisScore,
      ledger,path:frame.path,currentState:state,candidates:next,lookahead,
      explorer,client,model,usage,log,step:++step,onProgress:emit
    });

    // Causal traversal is semantic-only. Exact source is localized once after
    // the full accepted causal list is complete. Non-causal goals may still
    // inspect source during traversal when needed.
    const sourceAllowed=goal.kind!=='causal';
    const selectedEntry=frame.path.length===0&&state.id===entryRootId&&Number(frame.current?.score||0)>0;
    const emptyEntryDecision=selectedEntry&&
      !String(decision.hypothesis||'').trim()&&
      Number(decision.hypothesisScore||0)<=0&&
      !decision.inspectSource&&
      !arr(decision.picks).length;
    const forcedEntrySource=sourceAllowed&&emptyEntryDecision&&Boolean(String(state.body||state.callText||'').trim());
    const shouldInspectSource=sourceAllowed&&((decision.inspectSource&&sourceAllowed)||forcedEntrySource);
    let inspectedSource=false;
    if(shouldInspectSource&&step<MAX_STEPS){
      inspectedSource=true;
      if(forcedEntrySource){
        emit({
          action:'ENTRY_SOURCE_FALLBACK',goalId:goal.id,state:state.name,
          reason:'Selected entry produced no hypothesis, source request, or semantic continuation. Inspecting exact entry source before abandoning the branch.',
          path:path.map(x=>x.name)
        });
      }
      emit({
        action:'SOURCE_INSPECTION',goalId:goal.id,state:state.name,
        sourcePath:state.sourcePath,startLine:state.startLine,endLine:state.endLine,
        path:path.map(x=>x.name)
      });
      decision=await decide({
        question,mode,goals,activeGoalId:goal.id,branchId:entryRootId,hypothesis:decision.hypothesis||thread.hypothesis||frame.hypothesis,
        hypothesisContributions:thread.hypothesisContributions,previousHypothesisScore:thread.hypothesisScore,
        ledger,path:frame.path,currentState:state,candidates:next,lookahead,
        sourceBody:String(state.body||state.callText||''),
        explorer,client,model,usage,log,step:++step,onProgress:emit
      });
    }

    // Causal state is a living explanatory set, not an append-only history.
    // The model may retain a subset of old hl and add at most the current hc.
    // Revisions are accepted only when they preserve or strengthen explanatory score.
    let causalContributionRejected=false;
    let causalContributionRejectReason='';
    if(goal.kind==='causal'){
      const priorContributions=arr(thread.hypothesisContributions);
      const priorScore=Number(thread.hypothesisScore||0);
      const claim=String(decision.contribution||'').trim();
      const tentativeScore=Number(decision.hypothesisScore||0);
      const requestedIndexes=arr(decision.retainedContributionIndexes);
      const retainedPrior=retainCausalContributions(priorContributions,requestedIndexes);
      const revisionWeakens=priorContributions.length>0&&
        tentativeScore<priorScore-HYPOTHESIS_DELTA_EPSILON;

      if(revisionWeakens){
        causalContributionRejected=Boolean(claim);
        causalContributionRejectReason=claim
          ? 'The proposed causal revision reduced alignment of the explanatory set to the reported issue.'
          : '';
        decision.contribution='';
        decision.causalHypothesisComplete=false;
        decision.hypothesis=causalHypothesisText(priorContributions);
        decision.hypothesisScore=priorScore;
        decision.retainedContributionIndexes=priorContributions.map((_,index)=>index);
        decision.supportStates=dedupeStates(priorContributions.flatMap(item=>arr(item?.supportStates)));
        if(causalContributionRejected){
          decision.causalContributionRejected=true;
          emit({
            action:'CAUSAL_CONTRIBUTION_REJECTED',goalId:goal.id,state:state.name,
            evidenceRelevance:Number(decision.evidenceRelevance||0),
            previousScore:priorScore,tentativeScore,
            reason:causalContributionRejectReason,
            hypothesis:decision.hypothesis,
            hypothesisList:priorContributions.map(item=>item.claim),
            path:path.map(x=>x.name)
          });
        }
      }else{
        let revised=retainedPrior;
        if(claim){
          const evaluation=evaluateCausalContribution({
            priorContributions:retainedPrior,
            priorScore,
            contribution:claim,
            evidenceRelevance:decision.evidenceRelevance,
            tentativeScore,
            epsilon:HYPOTHESIS_DELTA_EPSILON
          });
          if(evaluation.duplicate){
            decision.contribution='';
          }else if(evaluation.rejected){
            causalContributionRejected=true;
            causalContributionRejectReason=evaluation.reason;
            decision.contribution='';
            decision.causalHypothesisComplete=false;
            decision.hypothesis=causalHypothesisText(priorContributions);
            decision.hypothesisScore=priorScore;
            decision.retainedContributionIndexes=priorContributions.map((_,index)=>index);
            decision.supportStates=dedupeStates(priorContributions.flatMap(item=>arr(item?.supportStates)));
            decision.causalContributionRejected=true;
            emit({
              action:'CAUSAL_CONTRIBUTION_REJECTED',goalId:goal.id,state:state.name,
              evidenceRelevance:Number(decision.evidenceRelevance||0),
              previousScore:priorScore,tentativeScore,
              reason:causalContributionRejectReason,
              hypothesis:decision.hypothesis,
              hypothesisList:priorContributions.map(item=>item.claim),
              path:path.map(x=>x.name)
            });
          }else if(evaluation.accepted){
            revised=[...retainedPrior,{
              claim,
              stateId:state.id,
              sourcePath:state.sourcePath||'',
              startLine:Number(state.startLine||0),
              endLine:Number(state.endLine||state.startLine||0),
              sourceGrounded:false,
              evidenceRelevance:Number(decision.evidenceRelevance||0),
              supportStates:dedupeStates(decision.supportStates||[])
            }];
          }
        }

        if(!causalContributionRejected){
          const beforeClaims=priorContributions.map(item=>item.claim);
          const afterClaims=revised.map(item=>item.claim);
          const changed=beforeClaims.length!==afterClaims.length||
            beforeClaims.some((claimText,index)=>claimText!==afterClaims[index]);
          thread.hypothesisContributions=revised;
          frame.hypothesisContributions=arr(revised);
          decision.hypothesis=causalHypothesisText(revised);
          decision.hypothesisScore=Math.max(priorScore,tentativeScore);
          decision.supportStates=dedupeStates(revised.flatMap(item=>arr(item?.supportStates)));
          if(changed){
            emit({
              action:'CAUSAL_HYPOTHESIS_REVISED',goalId:goal.id,state:state.name,
              previousScore:priorScore,
              hypothesisScore:Number(decision.hypothesisScore||0),
              previousHypothesisList:beforeClaims,
              hypothesisList:afterClaims,
              retainedContributionIndexes:requestedIndexes,
              contribution:decision.contribution||'',
              complete:!!decision.causalHypothesisComplete,
              path:path.map(x=>x.name)
            });
          }
        }
      }
    }

    // Every top-level entry keeps an independent causal list and score.
    // The strongest other entry is an incumbent benchmark only. A causal
    // entry may remain below it while its own score is still strengthening;
    // pruning is driven by this entry's trend, not by absolute rank.
    const entryPrevious=thread.entryScores.get(entryRootId)||{
      id:entryRootId,name:entryRootName,bestScore:0,currentScore:0
    };
    const entryRecord={
      ...entryPrevious,
      id:entryRootId,
      name:entryRootName,
      currentScore:Number(decision.hypothesisScore||0),
      bestScore:Math.max(Number(entryPrevious.bestScore||0),Number(decision.hypothesisScore||0))
    };
    thread.entryScores.set(entryRootId,entryRecord);
    const bestOtherEntry=[...thread.entryScores.values()]
      .filter(item=>item.id!==entryRootId)
      .sort((a,b)=>Number(b.bestScore||0)-Number(a.bestScore||0))[0]||null;
    const sourceOpportunityComplete=!decision.inspectSource||inspectedSource;
    const entryBranchDominated=goal.kind!=='causal'&&Boolean(
      bestOtherEntry&&sourceOpportunityComplete&&
      Number(decision.hypothesisScore||0)<Number(bestOtherEntry.bestScore||0)
    );
    emit({
      action:'ENTRY_BRANCH_SCORE',goalId:goal.id,
      entryId:entryRootId,entry:entryRootName,
      currentScore:Number(decision.hypothesisScore||0),
      branchBestScore:entryRecord.bestScore,
      incumbentEntry:bestOtherEntry?.name||'',
      incumbentScore:Number(bestOtherEntry?.bestScore||0),
      dominated:entryBranchDominated,
      entryBranches:[...thread.entryScores.values()].map(item=>({
        id:item.id,name:item.name,currentScore:Number(item.currentScore||0),bestScore:Number(item.bestScore||0)
      })),
      path:path.map(x=>x.name)
    });

    // Causal traversal trusts learned semantics. A complete causal chain with
    // hs >= CAUSAL_ACCEPT_SCORE is sufficient to stop exploration. At that
    // point LeMap performs one source-localization pass for the whole hl.
    // Counterfactual validation is optional and is not a resolution gate.
    const acceptedCausalContributions=arr(thread.hypothesisContributions);
    const causalReadyForSource=goal.kind==='causal'&&
      !causalContributionRejected&&
      decision.causalHypothesisComplete&&
      Number(decision.hypothesisScore||0)>=CAUSAL_ACCEPT_SCORE&&
      acceptedCausalContributions.length>0;

    if(causalReadyForSource){
      const sourceKey=[
        decision.hypothesis||'',
        ...acceptedCausalContributions.map(item=>item.claim)
      ].join('|');
      const rawCausalEvidence=dedupeStates(
        acceptedCausalContributions.flatMap(item=>arr(item?.supportStates))
      );
      let localizedRecord=thread.sourceLocalizationByHypothesis.get(sourceKey);
      if(!localizedRecord){
        const ranges=await localizeCausalHypothesis({
          question,
          hypothesisContributions:acceptedCausalContributions,
          evidenceStates:rawCausalEvidence,
          client,model,usage,log
        });
        localizedRecord={
          ranges,
          states:localizedRangeStates(rawCausalEvidence,ranges),
          complete:causalSourceCoverageComplete(ranges,acceptedCausalContributions.length)
        };
        thread.sourceLocalizationByHypothesis.set(sourceKey,localizedRecord);
        emit({
          action:'CAUSAL_SOURCE_LOCALIZED',goalId:goal.id,
          hypothesisList:acceptedCausalContributions.map(item=>item.claim),
          evidenceRanges:ranges,
          coverageComplete:localizedRecord.complete,
          path:path.map(x=>x.name)
        });
      }

      if(localizedRecord.complete&&localizedRecord.states.length){
        thread.hypothesisContributions=acceptedCausalContributions.map((item,index)=>({
          ...item,
          sourceGrounded:localizedRecord.ranges.some(range=>
            arr(range?.contributionIndexes).map(Number).includes(index)
          )
        }));
        frame.hypothesisContributions=arr(thread.hypothesisContributions);
        decision.supportStates=localizedRecord.states;
        decision.evidenceRanges=localizedRecord.ranges;
        decision.goalResolutions=[goal.id];
        decision.hardConstraintsMet=true;
        decision.explained=!goals.some(item=>item.id!==goal.id&&item.status!=='resolved');
        emit({
          action:'CAUSAL_HYPOTHESIS_ACCEPTED',goalId:goal.id,
          hypothesis:decision.hypothesis,
          hypothesisScore:Number(decision.hypothesisScore||0),
          hypothesisList:thread.hypothesisContributions.map(item=>item.claim),
          path:path.map(x=>x.name)
        });
      }else{
        emit({
          action:'CAUSAL_SOURCE_INCOMPLETE',goalId:goal.id,
          hypothesis:decision.hypothesis,
          hypothesisScore:Number(decision.hypothesisScore||0),
          path:path.map(x=>x.name)
        });
      }
    }

    // Compare the updated accumulated hypothesis with the previous state.
    const previousScore=Number(thread.hypothesisScore||0);
    const progress=hypothesisProgress(previousScore,decision.hypothesisScore);
    thread.hypothesisScore=decision.hypothesisScore;
    const hasAcceptedCausalEvidence=goal.kind==='causal'&&arr(thread.hypothesisContributions).length>0;
    if(goal.kind==='causal'){
      const pathFlatSteps=Number(frame.flatSteps||0);
      thread.flatSteps=progress.trend==='flat'?pathFlatSteps+1:0;
      frame.flatSteps=thread.flatSteps;
    }else{
      thread.flatSteps=progress.trend==='flat'?thread.flatSteps+1:0;
    }
    if(!decision.causalRejected&&decision.hypothesisScore>thread.bestScore){
      thread.bestScore=decision.hypothesisScore;
      thread.bestHypothesis=decision.hypothesis||thread.hypothesis;
      thread.bestHypothesisContributions=arr(thread.hypothesisContributions);
      thread.bestConstraintChecklist=decision.constraintChecklist;
      thread.bestSupportStates=dedupeStates(decision.supportStates||[]);
    }
    if(!decision.causalRejected&&decision.hardConstraintsMet){
      thread.bestHypothesis=decision.hypothesis||thread.bestHypothesis||thread.hypothesis;
      thread.bestHypothesisContributions=arr(thread.hypothesisContributions);
      thread.bestConstraintChecklist=decision.constraintChecklist;
      thread.bestSupportStates=dedupeStates(decision.supportStates||thread.bestSupportStates||[]);
    }
    emit({
      action:'HYPOTHESIS_PROGRESS',goalId:goal.id,
      hypothesis:decision.hypothesis||thread.hypothesis,
      hypothesisList:arr(thread.hypothesisContributions).map(item=>({
        claim:item.claim||'',
        sourcePath:item.sourcePath||'',
        startLine:Number(item.startLine||0),
        endLine:Number(item.endLine||item.startLine||0),
        sourceGrounded:item.sourceGrounded===true,
        evidenceRelevance:Number(item.evidenceRelevance||0)
      })),
      evidenceRelevance:Number(decision.evidenceRelevance||0),
      hypothesisScore:decision.hypothesisScore,
      previousScore,delta:progress.delta,trend:progress.trend,
      bestScore:thread.bestScore,constraintChecklist:decision.constraintChecklist,
      evidenceRanges:decision.evidenceRanges,
      counterfactualValidation:decision.counterfactualValidation||null,
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
    frame.hypothesisContributions=arr(thread.hypothesisContributions);
    rollingHypothesis=thread.hypothesis||rollingHypothesis;
    applyLedgerDecision({
      ledger,goal,branchId:entryRootId,additions:decision.additions,disputes:decision.disputes,
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
      action:'FACTS',goalId:goal.id,facts:ledgerView(ledger,{goals,activeGoalId:goal.id,branchId:entryRootId}),
      goalScore:decision.activeGoalScore,hypothesisScore:decision.hypothesisScore,hypothesis:thread.hypothesis,
      explained:allGoalsResolved(goals),goals:goalView(goals)
    });

    if(allGoalsResolved(goals))break;
    if(goal.status==='resolved')continue;

    const unresolvedHard=new Set(decision.constraintChecklist
      .map((row,index)=>({index,score:Number(row[1]||0),kind:row[2]}))
      .filter(item=>item.kind==='hard'&&item.score<GOAL_CLOSE_SCORE)
      .map(item=>item.index));
    if(causalContributionRejected){
      frame.frontierIds=[];
      emit({
        action:'BRANCH_PRUNED',goalId:goal.id,state:state.name,
        reason:causalContributionRejectReason,
        evidenceRelevance:Number(decision.evidenceRelevance||0),
        hypothesisScore:Number(thread.hypothesisScore||0),
        hypothesisList:arr(thread.hypothesisContributions).map(item=>item.claim),
        path:path.map(x=>x.name)
      });
      await resumeThread(thread);
      continue;
    }

    if(entryBranchDominated){
      emit({
        action:'ENTRY_BRANCH_PRUNED',goalId:goal.id,
        entry:entryRootName,entryScore:Number(decision.hypothesisScore||0),
        incumbentEntry:bestOtherEntry?.name||'',incumbentScore:Number(bestOtherEntry?.bestScore||0),
        reason:'Entry branch fell below an already established entry-level score.',
        entryBranches:[...thread.entryScores.values()].map(item=>({
          id:item.id,name:item.name,currentScore:Number(item.currentScore||0),bestScore:Number(item.bestScore||0)
        })),
        path:path.map(x=>x.name)
      });
      while(thread.stack.length>1&&thread.stack.at(-1).entryRootId===entryRootId){
        thread.stack.pop();
      }
      const rootFrame=thread.stack.at(-1);
      if(rootFrame?.entryRootId===entryRootId)rootFrame.frontierIds=[];
      await resumeThread(thread);
      continue;
    }

    const warm=decision.picks.filter(pick=>{
      const currentScore=Number(decision.hypothesisScore||0);
      const expectedScore=Number(pick.score||0);
      const strengthens=expectedScore>currentScore+HYPOTHESIS_DELTA_EPSILON;
      const staysFlat=Math.abs(expectedScore-currentScore)<=HYPOTHESIS_DELTA_EPSILON;
      const targetsUnresolved=arr(pick.targets).some(index=>unresolvedHard.has(index));
      const canSpendFlatStep=progress.trend!=='weakening'&&Number(frame.flatSteps||0)<MAX_FLAT_STEPS;
      const hasAcceptedHypothesis=arr(thread.hypothesisContributions).length>0;

      // A strengthening prediction always wins. Flat causal wrappers may also
      // be traversed for at most the path-local flat budget. Before the first
      // accepted hc, require bounded lookahead so we do not wander into arbitrary
      // zero-score leaves just to keep searching.
      if(goal.kind==='causal'){
        const flatSearchable=staysFlat&&canSpendFlatStep&&(hasAcceptedHypothesis||pick.hasLookahead);
        return strengthens||flatSearchable;
      }
      return strengthens||(staysFlat&&targetsUnresolved&&canSpendFlatStep);
    });
    if(warm.length){
      thread.stack.push({
        path,current:warm[0],alternatives:warm.slice(1),
        hypothesis:thread.hypothesis||decision.hypothesis,hypothesisScore:thread.hypothesisScore,
        hypothesisContributions:arr(thread.hypothesisContributions),
        baseHypothesis:thread.hypothesis||decision.hypothesis,baseScore:thread.hypothesisScore,
        baseHypothesisContributions:arr(thread.hypothesisContributions),
        flatSteps:thread.flatSteps,
        baseFlatSteps:thread.flatSteps,
        navigationKind,frontierIds:[],
        entryRootId,entryRootName
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
        candidates:decision.picks.map(pick=>({name:pick.state.name,expected:pick.score,targets:pick.targets,hasLookahead:!!pick.hasLookahead})),
        path:path.map(x=>x.name)
      });
    }

    // Flat exploration is tolerated briefly only while a branch still appears
    // capable of resolving an unmet hard constraint. Otherwise backtrack and
    // compare alternate branch potential with the best hypothesis seen so far.
    if(goal.kind!=='causal'||arr(thread.hypothesisContributions).length>0){
      if(thread.flatSteps>=MAX_FLAT_STEPS){
      emit({
        action:'HYPOTHESIS_FLAT',goalId:goal.id,state:state.name,
        hypothesis:thread.hypothesis,hypothesisScore:thread.hypothesisScore,
        bestScore:thread.bestScore,constraintChecklist:decision.constraintChecklist,
        path:path.map(x=>x.name)
      });
      }
    }

    await resumeThread(thread);
  }

  if(allGoalsResolved(goals)){
    finalExplanation=goals.map(goal=>goal.summary).filter(Boolean).join(' ');
    const resolvedEvidence=goalEvidenceStates(goals);
    finalEvidence=dedupeStates(resolvedEvidence.length?resolvedEvidence:ledgerEvidenceStates(ledger));
  }

  if(!finalExplanation){
    const unresolved=unresolvedGoals(goals);
    const bestThreads=unresolved.map(goal=>{
      const thread=threads.get(goal.id);
      return {
        goalId:goal.id,
        hypothesis:thread?.bestHypothesis||thread?.hypothesis||'',
        score:Number(thread?.bestScore||thread?.hypothesisScore||0),
        constraintChecklist:arr(thread?.bestConstraintChecklist),
        supportStates:dedupeStates(thread?.bestSupportStates||[])
      };
    });
    const best=bestThreads
      .filter(item=>item.hypothesis)
      .sort((a,b)=>b.score-a.score)[0]||null;
    const bestEvidence=best?best.supportStates:[];
    const bestRanges=bestEvidence.map((state,index)=>({
      rank:index+1,
      symbolId:state.symbolId||'',
      name:state.name||'',
      sourcePath:state.sourcePath||'',
      startLine:Number(state.startLine||0),
      endLine:Number(state.endLine||state.startLine||0),
      why:text(state.evidenceWhy||codeSemanticForState(state,explorer)?.effect||codeSemanticForState(state,explorer)?.purpose||'',260)
    })).filter(range=>range.sourcePath&&range.startLine&&range.endLine>=range.startLine);
    const status=best?'best_so_far_exhausted':'exhausted';
    const bestHypothesis=best?.hypothesis||rollingHypothesis||'';
    const bestScore=Number(best?.score||0);
    const bestConstraints=arr(best?.constraintChecklist);
    emit({
      action:'SEARCH_EXHAUSTED',explained:false,status,
      hypothesis:bestHypothesis,hypothesisScore:bestScore,bestScore,
      constraintChecklist:bestConstraints,evidenceRanges:bestRanges,
      goals:goalView(goals)
    });
    log('query_v5_complete',{
      complete:false,status,mode,goals:goalView(goals),explained:false,
      hypothesis:bestHypothesis,bestScore,constraintChecklist:bestConstraints,
      ranges:bestRanges,facts:ledgerView(ledger,{all:true}),events,usage
    });
    const diag=diagnostics();log('query_v5_diagnostics',diag);
    const remaining=unresolved.map(goal=>`${goal.id} ${goal.text}`).join('; ');
    const weakHard=bestConstraints
      .filter(row=>row[2]==='hard'&&Number(row[1]||0)<GOAL_CLOSE_SCORE)
      .map(row=>`${row[0]} (${Math.round(Number(row[1]||0)*100)}%)`);
    const failedCounterfactual=unresolved
      .map(goal=>threads.get(goal.id)?.counterfactualValidation)
      .find(item=>item&&!item.pass);
    const counterfactualFailure=failedCounterfactual?.failure||'';
    const incompleteAnswer=best
      ? `Best hypothesis found, but the goal is not resolved. ${bestHypothesis}${weakHard.length?` Unresolved/weak criteria: ${weakHard.join('; ')}.`:''}${counterfactualFailure?` Counterfactual validation failed: ${counterfactualFailure}`:''}`
      : (remaining?`The explored semantic evidence did not yet resolve: ${remaining}`:'The explored semantic evidence did not yet resolve the request.');
    return {
      answer:incompleteAnswer,status,mode,goals:goalView(goals),complete:false,explained:false,
      hypothesis:bestHypothesis,hypothesisScore:bestScore,constraintChecklist:bestConstraints,
      counterfactualValidation:failedCounterfactual||null,
      facts:ledgerView(ledger,{all:true}),ranges:bestRanges,events,usage,diagnostics:diag,
      sweExplore:sweExploreView(bestRanges),
      investigation:{mode:'code-flow-goals-v5',reasoningMode:mode,goals:goalView(goals),status,usage}
    };
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
    why:text(state.evidenceWhy||codeSemanticForState(state,explorer)?.effect||codeSemanticForState(state,explorer)?.purpose||'',260)
  })).filter(range=>{
    if(!range.sourcePath||!range.startLine||range.endLine<range.startLine)return false;
    const key=[range.sourcePath,range.startLine,range.endLine].join(':');
    if(seenRanges.has(key))return false;
    seenRanges.add(key);return true;
  }).map((range,index)=>({...range,rank:index+1}));
  const synthesized=await synthesizeResolvedAnswer({question,goals,threads,client,model,usage,log});
  const locations=ranges.map(range=>`${range.sourcePath}#${range.name} ${range.startLine}-${range.endLine}${range.why?' — '+range.why:''}`).join('\n');
  const answer=synthesized||finalExplanation+(locations?'\n\n'+locations:'');
  log('query_v5_complete',{complete:true,status:'resolved',mode,goals:goalView(goals),explained:true,hypothesis:finalExplanation,answer,facts:ledgerView(ledger,{all:true}),ranges,events,usage});
  const diag=diagnostics();log('query_v5_diagnostics',diag);
  return {answer,status:'resolved',mode,goals:goalView(goals),complete:true,explained:true,hypothesis:finalExplanation,facts:ledgerView(ledger,{all:true}),ranges,events,usage,diagnostics:diag,sweExplore:sweExploreView(ranges),investigation:{mode:'code-flow-goals-v5',reasoningMode:mode,goals:goalView(goals),status:'resolved',usage}};
}
