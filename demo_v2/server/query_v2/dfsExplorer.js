import { addUsage, arr, key, modelJson, text } from './modelJson.js';
import { leafEvidence, linkedNeighbours } from './graphContext.js';
import { exploreLinkedEntities } from './linkedExplorer.js';
import { decisionPayload, decodeSparseDecision, dimensionCodec, acceptedSummary, uncoveredDimensionIndexes } from './decisionProtocol.js';
import { partitionCandidates, remainingWarmAlternativeCount, WARM_ALTERNATIVE_MIN_CONFIDENCE } from './alternativePolicy.js';

const MAX_DFS_STEPS = 64;
const OPTION_SYSTEM = `Score the supplied visible semantic options for confidence-ordered DFS. d maps dimension index to meaning; u lists uncovered dimension indexes; a lists already accepted entities and covered dimension indexes; o is [optionIndex,name,shortDescription]. Return JSON only: {"c":[[optionIndex,[[dimensionIndex,confidence]]]],"r":[optionIndex]}. Put in c ONLY options having meaningful confidence >= 0.5 on at least one supplied dimension. Put in r ONLY options that can be explicitly ruled out from the supplied name/description. Omitted options remain unassessed and eligible in LeMap internal state. No reasons, names, zero scores, weak 0.1/0.2 guesses, or extra keys.`;
const LEAF_SYSTEM = `Judge one entity leaf. d maps dimension indexes; u lists uncovered indexes; a lists accepted entities; e contains entity name, short description and up to five semantic field hints; q is the count of warm alternatives LeMap can try next. Return JSON only: {"x":"a|n|r","d":[[dimensionIndex,confidence]]}. a=accept this entity now; n=do not use it now and let LeMap try the next internal alternative if q>0; r=explicitly reject this entity. Field hints are semantic evidence only; all entity fields remain available. Do not select fields or joins. Do not ask for or name alternatives.`;

const fmtTokens = (u) => `prompt ${Number(u?.prompt||0)} | output ${Number(u?.completion||0)} | call ${Number(u?.total||0)}`;
const fmtCum = (u) => `cumulative ${Number(u?.total||0)}`;
const fmtDims = (ds) => arr(ds).map((d)=>`${d.dimension}=${Number(d.confidence||0).toFixed(2)}`).join(', ') || '-';
const fmtPath = (path) => arr(path).map((p)=>p.name||p).filter(Boolean).join(' → ') || 'ROOT';
const confidenceOf = (ds) => Math.max(0, ...arr(ds).map((d)=>Number(d?.confidence||0)));

function normalizeDimensionPairs(pairs, codec) {
  return arr(pairs).map((pair) => {
    if (!Array.isArray(pair)) return null;
    const name = codec.byIndex.get(String(pair[0]));
    const confidence = Math.max(0, Math.min(1, Number(pair[1]||0)));
    return name && confidence > 0 ? { dimension:name, confidence } : null;
  }).filter(Boolean);
}
function compactAssessment(item) { return item ? { id:item.id, name:item.name, score:item.confidence, dimensions:item.dimensions } : null; }
function compactFrame(frame) {
  if (frame.kind === 'link') return { kind:'link', from:frame.fromEntity, to:frame.toEntity };
  return {
    kind:'hierarchy',
    current:compactAssessment(frame.current),
    alternativeCount:arr(frame.alternatives).length,
    deferredCount:arr(frame.deferred).length,
    coldCount:arr(frame.cold).length
  };
}
function traceFrame(step, path, frame, usage) {
  console.log(`[lemap query-v2][DFS ${step}] PATH ${fmtPath(path)}`);
  if (frame.current) console.log(`  CURRENT: ${frame.current.name} | ${fmtDims(frame.current.dimensions)} | score ${Number(frame.current.confidence||0).toFixed(2)}`);
  console.log(`  WARM ALTERNATIVES: ${arr(frame.alternatives).length} | COLD <${WARM_ALTERNATIVE_MIN_CONFIDENCE.toFixed(1)}: ${arr(frame.cold).length} | REJECTED: ${arr(frame.rejected).length}`);
  console.log(`  ${fmtCum(usage)}`);
}
function pathForNode(nodeId, hierarchy) {
  const path=[]; let id=nodeId;
  while (id) { const node=hierarchy.byId.get(id); if(!node) break; path.push({id:node.id,type:node.type,name:node.name}); id=hierarchy.parentById.get(id); }
  return path.reverse();
}
function coverage(accepted, dimensions) {
  const covered=new Set();
  for (const item of accepted.values()) for (const d of arr(item.dimensions)) if(Number(d.confidence||0)>0) covered.add(key(d.dimension));
  return { covered:[...covered], missing:arr(dimensions).filter((d)=>!covered.has(key(d))) };
}
function acceptedConnected(accepted, traversedJoins) {
  const names=[...accepted.values()].map((i)=>i.entity); if(names.length<=1) return true;
  const wanted=new Set(names.map(key)), adjacency=new Map();
  for(const join of traversedJoins.values()){ const a=key(join.from),b=key(join.to); if(!adjacency.has(a))adjacency.set(a,new Set()); if(!adjacency.has(b))adjacency.set(b,new Set()); adjacency.get(a).add(b); adjacency.get(b).add(a); }
  const seen=new Set(), queue=[key(names[0])];
  while(queue.length){ const cur=queue.shift(); if(seen.has(cur))continue; seen.add(cur); for(const n of adjacency.get(cur)||[]) if(!seen.has(n))queue.push(n); }
  return [...wanted].every((n)=>seen.has(n));
}
function joinSignature(join){ return `${key(join?.from)}|${key(join?.to)}|${key(join?.relationship)}|${arr(join?.keyMaps).map((m)=>`${key(m.fieldName)}:${key(m.relatedFieldName)}`).join(',')}`; }

async function assessOptions({ intent, dimensions, accepted, options, client, model, log, usage, step }) {
  const coded=decisionPayload({intent,dimensions,accepted,options,descriptionMax:80});
  log('query_v2_dfs_payload',{step,phase:'score_options',payload:coded.payload});
  const call=await modelJson(client,model,OPTION_SYSTEM,coded.payload,{maxTokens:420});
  addUsage(usage,call.usage);
  console.log(`[lemap query-v2][DFS ${step}] SCORE tokens: ${fmtTokens(call.usage)} | ${fmtCum(usage)}`);
  const assessments=decodeSparseDecision(call.parsed,options,dimensions,coded.optionMap,coded.dimensionMap,{omittedDecision:'unassessed'});
  log('query_v2_dfs_model',{step,phase:'score_options',assessments,usage:call.usage,cumulativeUsage:{...usage}});
  return assessments;
}
function makeHierarchyFrame(assessments){
  const { warm, cold }=partitionCandidates(assessments);
  return {
    kind:'hierarchy',
    current:warm[0]||null,
    alternatives:warm.slice(1),
    deferred:[],
    cold,
    unassessed:arr(assessments).filter((i)=>i.decision==='unassessed'),
    rejected:arr(assessments).filter((i)=>i.decision==='reject')
  };
}
function recordRejected(frame,rejected){ for(const item of arr(frame.rejected)) rejected.set(item.id,{id:item.id,name:item.name}); }
function promoteAlternative(stack,hierarchy,usage){
  while(stack.length){
    const top=stack.at(-1);
    if(top.kind==='link'){console.log(`[lemap query-v2][DFS POP] link ${top.fromEntity} → ${top.toEntity} | ${fmtCum(usage)}`);stack.pop();continue;}
    if(top.alternatives.length){const next=top.alternatives.shift();top.current=next;console.log(`[lemap query-v2][DFS RESUME] next internal alternative | remaining ${top.alternatives.length} | score ${Number(next.confidence||0).toFixed(2)} | ${fmtCum(usage)}`);return hierarchy.byId.get(next.id)||null;}
    const deferred=top.deferred.find((i)=>Number(i.revisits||0)<1&&Number(i.confidence||0)>=WARM_ALTERNATIVE_MIN_CONFIDENCE);
    if(deferred){deferred.revisits=Number(deferred.revisits||0)+1;top.current=deferred;console.log(`[lemap query-v2][DFS RESUME] deferred internal alternative | ${fmtCum(usage)}`);return hierarchy.byId.get(deferred.id)||null;}
    stack.pop();
  }
  return null;
}
async function inspectLeaf({ intent, dimensions, accepted, alternativeCount, node, index, semanticHints, client, model, log, usage, step }) {
  const codec=dimensionCodec(dimensions);
  const payload={ i:text(intent,140), d:codec.names.map((name,i)=>[i,name]), u:uncoveredDimensionIndexes(accepted,dimensions,codec), a:acceptedSummary(accepted,codec), q:Number(alternativeCount||0), e:leafEvidence(node.entityName,index,semanticHints) };
  log('query_v2_dfs_payload',{step,phase:'leaf',payload});
  const call=await modelJson(client,model,LEAF_SYSTEM,payload,{maxTokens:160}); addUsage(usage,call.usage);
  console.log(`[lemap query-v2][DFS ${step}] LEAF tokens: ${fmtTokens(call.usage)} | ${fmtCum(usage)}`);
  const dims=normalizeDimensionPairs(call.parsed?.d,codec);
  const map={a:'accept',n:'next',r:'reject'};
  const result={decision:map[String(call.parsed?.x||'')]||'next',dimensions:dims,confidence:confidenceOf(dims),reason:''};
  log('query_v2_dfs_model',{step,phase:'leaf',entity:node.entityName,result,usage:call.usage,cumulativeUsage:{...usage}}); return result;
}

export async function deriveQueryDimensions({ question, client, model, log, usage }) {
  const system='Identify stable business dimensions/measures/time/filter concepts needed to answer the query. Return {"intent":"short","dimensions":[{"name":"canonical concept","role":"measure|dimension|time|filter|attribute|derived"}]}. Do not choose clusters, entities or fields.';
  const call=await modelJson(client,model,system,{question},{maxTokens:400}); addUsage(usage,call.usage);
  console.log(`[lemap query-v2][DIMENSIONS] tokens: ${fmtTokens(call.usage)} | ${fmtCum(usage)}`);
  const dimensions=arr(call.parsed?.dimensions).slice(0,12).map((i)=>({name:text(i?.name,80),role:text(i?.role,24)})).filter((i)=>i.name);
  const logicalRequest={intent:text(call.parsed?.intent,140),dimensions}; log('query_v2_dimensions',{question,logicalRequest,usage:call.usage,cumulativeUsage:{...usage}}); return logicalRequest;
}

export async function exploreSemanticDfs({ question, logicalRequest, hierarchy, index, semanticHints, client, model, log, usage }) {
  const dimensions=logicalRequest.dimensions.map((i)=>i.name), accepted=new Map(), rejected=new Map(), rejectedEntityKeys=new Set(), exploredEntityKeys=new Set(), traversedJoins=new Map(), stack=[], events=[]; let step=0;
  let assessments=await assessOptions({intent:logicalRequest.intent,dimensions,accepted,options:hierarchy.clusters,client,model,log,usage,step:++step});
  let frame=makeHierarchyFrame(assessments); recordRejected(frame,rejected); stack.push(frame); traceFrame(step,[],frame,usage); let current=frame.current?hierarchy.byId.get(frame.current.id):null;
  while(current&&step<MAX_DFS_STEPS){
    const path=pathForNode(current.id,hierarchy);
    if(current.type!=='entity'){
      assessments=await assessOptions({intent:logicalRequest.intent,dimensions,accepted,options:current.children,client,model,log,usage,step:++step});
      frame=makeHierarchyFrame(assessments); recordRejected(frame,rejected); stack.push(frame); traceFrame(step,path,frame,usage);
      events.push({step,action:'expand',path:path.map((p)=>p.name),current:frame.current,alternativeCount:frame.alternatives.length,coldCount:frame.cold.length,rejectedCount:frame.rejected.length});
      current=frame.current?hierarchy.byId.get(frame.current.id):promoteAlternative(stack,hierarchy,usage); continue;
    }
    exploredEntityKeys.add(key(current.entityName));
    const result=await inspectLeaf({intent:logicalRequest.intent,dimensions,accepted,alternativeCount:remainingWarmAlternativeCount(stack),node:current,index,semanticHints,client,model,log,usage,step:++step});
    console.log(`[lemap query-v2][DFS ${step}] LEAF ${fmtPath(path)} → ${result.decision.toUpperCase()} | ${fmtDims(result.dimensions)} | score ${result.confidence.toFixed(2)} | ${fmtCum(usage)}`);
    if(result.decision==='reject'){
      rejected.set(current.id,{id:current.id,name:current.name}); rejectedEntityKeys.add(key(current.entityName)); events.push({step,action:'reject_leaf',entity:current.name}); current=promoteAlternative(stack,hierarchy,usage); continue;
    }
    if(result.decision==='next'){
      const parent=[...stack].reverse().find((i)=>i.kind==='hierarchy');
      if(parent&&result.confidence>=WARM_ALTERNATIVE_MIN_CONFIDENCE&&!parent.deferred.some((i)=>i.id===current.id)){
        parent.deferred.push({id:current.id,name:current.name,dimensions:result.dimensions,confidence:result.confidence,revisits:0});
        parent.deferred.sort((a,b)=>b.confidence-a.confidence||a.name.localeCompare(b.name));
      }
      events.push({step,action:'next_alternative',entity:current.name,confidence:result.confidence}); current=promoteAlternative(stack,hierarchy,usage); continue;
    }
    accepted.set(key(current.entityName),{entity:current.entityName,path:path.map((p)=>p.name),dimensions:result.dimensions,confidence:result.confidence,reason:''}); events.push({step,action:'accept_leaf',entity:current.name,dimensions:result.dimensions}); console.log(`[lemap query-v2][DFS ACCEPT] ${current.entityName} | accepted ${accepted.size} | ${fmtCum(usage)}`);
    const blocked=new Set([...exploredEntityKeys,...rejectedEntityKeys,...accepted.keys()]);blocked.delete(key(current.entityName)); const linked=linkedNeighbours(current.entityName,index,{blockedEntityKeys:blocked});
    for(const connection of linked.connections){if(!accepted.has(key(connection.entity)))continue;traversedJoins.set(joinSignature(connection.join),connection.join);events.push({step,action:'connect_existing',from:current.entityName,to:connection.entity});}
    if(linked.eligible.length){
      console.log(`[lemap query-v2][LINK] ${current.entityName}: ${linked.eligible.length} new eligible neighbours`);
      const linkedResult=await exploreLinkedEntities({intent:logicalRequest.intent,dimensions,accepted,sourceEntity:current.entityName,eligibleLinks:linked.eligible,hierarchy,excludedNodeIds:new Set(rejected.keys()),client,model,log,usage,startStep:step}); step=linkedResult.step; for(const entityKey of linkedResult.rejectedEntityKeys)rejectedEntityKeys.add(entityKey);
      if(linkedResult.choice&&!exploredEntityKeys.has(key(linkedResult.choice.entity))&&!rejectedEntityKeys.has(key(linkedResult.choice.entity))){const targetPaths=arr(hierarchy.pathsByEntity.get(key(linkedResult.choice.entity))).filter((item)=>!item.path.some((part)=>rejected.has(part.id)));const targetPath=targetPaths[0],targetNode=targetPath?hierarchy.byId.get(targetPath.pathId):null;if(targetNode){for(const join of arr(linkedResult.choice.joins))traversedJoins.set(joinSignature(join),join);stack.push({kind:'link',fromEntity:current.entityName,toEntity:linkedResult.choice.entity});events.push({step,action:'follow_link',from:current.entityName,to:linkedResult.choice.entity});current=targetNode;continue;}}
    }
    const cov=coverage(accepted,dimensions), connected=acceptedConnected(accepted,traversedJoins); if(!cov.missing.length&&connected){console.log(`[lemap query-v2][DFS DONE] all dimensions covered and trail connected | ${fmtCum(usage)}`);break;} current=promoteAlternative(stack,hierarchy,usage);
  }
  const finalCoverage=coverage(accepted,dimensions),connected=acceptedConnected(accepted,traversedJoins); return {accepted:[...accepted.values()],rejected:[...rejected.values()],traversedJoins:[...traversedJoins.values()],stack:stack.map(compactFrame),coverage:finalCoverage,connected,complete:!finalCoverage.missing.length&&connected,steps:step,events};
}
