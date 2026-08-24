import { addUsage, arr, key, modelJson } from './modelJson.js';
import { filterHierarchyForEntities } from './semanticHierarchy.js';
import { decisionPayload, decodeSparseDecision, dimensionCodec, acceptedSummary, uncoveredDimensionIndexes } from './decisionProtocol.js';
import { partitionCandidates, WARM_ALTERNATIVE_MIN_CONFIDENCE } from './alternativePolicy.js';

const SCORE_SYSTEM = `Score NAVIGATION RELEVANCE only for the supplied hierarchy branches of directly linked still-eligible entities. d maps dimension indexes; u lists dimensions still uncovered by accepted leaves; a lists accepted entities; o is [optionIndex,name,shortDescription]. A score means confidence that useful linked entities for that dimension may exist somewhere under this branch; it does NOT mean the dimension is covered. Return JSON only: {"c":[[optionIndex,[[dimensionIndex,confidence]]]],"r":[optionIndex]}. Return AT MOST 8 candidate branches total. Prefer the strongest 1-2 branches for each uncovered dimension and deduplicate branches that help multiple dimensions. Do NOT score every branch and do NOT emit tiny background guesses just because a branch is present. Scores may be below 0.5 when a branch is genuinely plausible but uncertain. Put in r ONLY branches that can be explicitly ruled out from the supplied name/description. Omitted branches remain unassessed/eligible in LeMap internal state; omission is not rejection. No reasons, names, zero scores, or extra keys.`;
const EDGE_SYSTEM = `Judge one evidenced direct schema link as a NAVIGATION decision. d maps dimension indexes; u lists uncovered indexes; s is source entity; t is target entity; j contains exact evidenced joins; q is the count of warm linked alternatives LeMap can try next. Return JSON only: {"x":"f|n|r","d":[[dimensionIndex,confidence]]}. d expresses how promising the target is for finding the uncovered dimensions; it does NOT mark those dimensions covered. f=follow now, n=do not follow this link now and let LeMap try its next internal alternative if q>0, r=explicit reject. Never invent joins and do not ask for alternative names.`;

const confidence=(dims)=>Math.max(0,...arr(dims).map((d)=>Number(d?.confidence||0)));
const fmtDims=(dims)=>arr(dims).map((d)=>`${d.dimension}=${Number(d.confidence||0).toFixed(2)}`).join(', ')||'-';
function normalizePairs(pairs,codec){return arr(pairs).map((p)=>{if(!Array.isArray(p))return null;const name=codec.byIndex.get(String(p[0]));const c=Math.max(0,Math.min(1,Number(p[1]||0)));return name&&c>0?{dimension:name,confidence:c}:null;}).filter(Boolean);}
function joinSummary(joins){return arr(joins).map((j)=>({from:j.from,to:j.to,relationship:j.relationship,cardinality:j.cardinality,keyMaps:j.keyMaps}));}

async function score({intent,dimensions,accepted,options,client,model,log,usage,step}){
  const coded=decisionPayload({intent,dimensions,accepted,options,descriptionMax:70});
  log('query_v2_link_payload',{step,phase:'score',payload:coded.payload});
  const call=await modelJson(client,model,SCORE_SYSTEM,coded.payload,{maxTokens:360}); addUsage(usage,call.usage);
  console.log(`[lemap query-v2][LINK ${step}] SCORE tokens: prompt ${call.usage.prompt} | output ${call.usage.completion} | call ${call.usage.total} | cumulative ${usage.total}`);
  const assessments=decodeSparseDecision(call.parsed,options,dimensions,coded.optionMap,coded.dimensionMap,{omittedDecision:'unassessed'});
  const {warm,cold}=partitionCandidates(assessments);
  if(warm[0])console.log(`  CURRENT: ${warm[0].name} | ${fmtDims(warm[0].dimensions)} | score ${warm[0].confidence.toFixed(2)}`);
  console.log(`  WARM ALTERNATIVES: ${Math.max(0,warm.length-1)} | COLD <${WARM_ALTERNATIVE_MIN_CONFIDENCE.toFixed(1)}: ${cold.length} | UNASSESSED: ${assessments.filter((x)=>x.decision==='unassessed').length} | REJECTED: ${assessments.filter((x)=>x.decision==='reject').length}`);
  log('query_v2_link_model',{step,phase:'score',assessments,usage:call.usage,cumulativeUsage:{...usage}}); return assessments;
}

async function inspectEdge({intent,dimensions,accepted,sourceEntity,targetEntity,joins,alternativeCount,client,model,log,usage,step}){
  const codec=dimensionCodec(dimensions);
  const payload={i:intent,d:codec.names.map((name,i)=>[i,name]),u:uncoveredDimensionIndexes(accepted,dimensions,codec),a:acceptedSummary(accepted,codec),s:sourceEntity,t:targetEntity,q:Number(alternativeCount||0),j:joinSummary(joins)};
  log('query_v2_link_payload',{step,phase:'edge',payload});
  const call=await modelJson(client,model,EDGE_SYSTEM,payload,{maxTokens:140}); addUsage(usage,call.usage);
  console.log(`[lemap query-v2][LINK ${step}] EDGE tokens: prompt ${call.usage.prompt} | output ${call.usage.completion} | call ${call.usage.total} | cumulative ${usage.total}`);
  const dims=normalizePairs(call.parsed?.d,codec), map={f:'follow',n:'next',r:'reject'}; const result={decision:map[String(call.parsed?.x||'')]||'next',dimensions:dims,confidence:confidence(dims)};
  log('query_v2_link_model',{step,phase:'edge',sourceEntity,targetEntity,result,usage:call.usage,cumulativeUsage:{...usage}}); return result;
}

export async function exploreLinkedEntities({intent,dimensions,accepted,sourceEntity,eligibleLinks,hierarchy,excludedNodeIds=new Set(),client,model,log,usage,startStep=0}){
  const byEntity=new Map(arr(eligibleLinks).map((i)=>[key(i.entity),i]));
  const linkedHierarchy=filterHierarchyForEntities(hierarchy,arr(eligibleLinks).map((i)=>i.entity),excludedNodeIds);
  const rejectedEntityKeys=new Set(), deferred=[], stack=[]; let step=startStep;
  if(!linkedHierarchy.clusters.length)return{choice:null,rejectedEntityKeys,step};
  let options=linkedHierarchy.clusters;
  while(options.length){
    const assessments=await score({intent,dimensions,accepted,options,client,model,log,usage,step:++step});
    const {warm,cold}=partitionCandidates(assessments); if(!warm.length)break;
    const frame={current:warm[0],alternatives:warm.slice(1),cold,unassessed:assessments.filter((x)=>x.decision==='unassessed')}; stack.push(frame); let current=linkedHierarchy.byId.get(frame.current.id);
    while(current){
      if(current.type!=='entity'){options=current.children;break;}
      const link=byEntity.get(key(current.entityName)); if(!link)break;
      const warmRemaining=stack.reduce((sum,f)=>sum+arr(f.alternatives).length,0)+deferred.filter((i)=>Number(i.confidence||0)>=WARM_ALTERNATIVE_MIN_CONFIDENCE).length;
      const edge=await inspectEdge({intent,dimensions,accepted,sourceEntity,targetEntity:current.entityName,joins:link.joins,alternativeCount:warmRemaining,client,model,log,usage,step:++step});
      console.log(`[lemap query-v2][LINK ${step}] ${sourceEntity} → ${current.entityName} ${edge.decision.toUpperCase()} | ${fmtDims(edge.dimensions)} | score ${edge.confidence.toFixed(2)} | cumulative ${usage.total}`);
      if(edge.decision==='follow')return{choice:{entity:current.entityName,joins:link.joins,dimensions:edge.dimensions,confidence:edge.confidence},rejectedEntityKeys,step};
      if(edge.decision==='reject')rejectedEntityKeys.add(key(current.entityName));
      else if(edge.confidence>=WARM_ALTERNATIVE_MIN_CONFIDENCE)deferred.push({entity:current.entityName,joins:link.joins,dimensions:edge.dimensions,confidence:edge.confidence});
      let next=null;
      while(stack.length&&!next){const top=stack.at(-1);if(top.alternatives.length){top.current=top.alternatives.shift();next=linkedHierarchy.byId.get(top.current.id);console.log(`[lemap query-v2][LINK RESUME] next internal alternative | remaining ${top.alternatives.length}`);}else stack.pop();}
      if(!next){const best=deferred.sort((a,b)=>b.confidence-a.confidence)[0]||null;return{choice:best,rejectedEntityKeys,step};}
      current=next; if(current.type!=='entity'){options=current.children;break;}
    }
  }
  return{choice:deferred.sort((a,b)=>b.confidence-a.confidence)[0]||null,rejectedEntityKeys,step};
}
