import { addUsage, arr, key, modelJson } from './modelJson.js';
import { filterHierarchyForEntities } from './semanticHierarchy.js';
import { decisionPayload, decodeSparseDecision, dimensionCodec, acceptedSummary, uncoveredDimensionIndexes } from './decisionProtocol.js';

const SCORE_SYSTEM = `Score ONLY the supplied hierarchy branches of directly linked still-eligible entities. d maps dimension indexes; u lists uncovered indexes; a lists accepted entities; o is [optionIndex,name,shortDescription]. Return JSON only: {"c":[[optionIndex,[[dimensionIndex,confidence]]]],"r":[optionIndex]}. Put in c EVERY branch that may matter at all, even weakly. Put in r ONLY branches that can be explicitly ruled out. Omitted branches remain eligible. No reasons, names, zero scores, or extra keys.`;
const EDGE_SYSTEM = `Judge one evidenced direct schema link. d maps dimension indexes; u lists uncovered indexes; s is source entity; t is target entity; j contains exact evidenced joins. Return JSON only: {"x":"f|l|r","d":[[dimensionIndex,confidence]]}. f=follow now, l=keep as alternative, r=explicit reject. Never invent joins.`;

const confidence=(dims)=>Math.max(0,...arr(dims).map((d)=>Number(d?.confidence||0)));
const fmtDims=(dims)=>arr(dims).map((d)=>`${d.dimension}=${Number(d.confidence||0).toFixed(2)}`).join(', ')||'-';
function normalizePairs(pairs,codec){return arr(pairs).map((p)=>{if(!Array.isArray(p))return null;const name=codec.byIndex.get(String(p[0]));const c=Math.max(0,Math.min(1,Number(p[1]||0)));return name&&c>0?{dimension:name,confidence:c}:null;}).filter(Boolean);}
function ranked(items){return arr(items).filter((i)=>i.decision==='candidate').sort((a,b)=>b.confidence-a.confidence||a.name.localeCompare(b.name));}
function pathForNode(nodeId,hierarchy){const path=[];let id=nodeId;while(id){const node=hierarchy.byId.get(id);if(!node)break;path.push({id:node.id,type:node.type,name:node.name});id=hierarchy.parentById.get(id);}return path.reverse();}
function joinSummary(joins){return arr(joins).map((j)=>({from:j.from,to:j.to,relationship:j.relationship,cardinality:j.cardinality,keyMaps:j.keyMaps}));}

async function score({intent,dimensions,accepted,options,client,model,log,usage,step}){
  const coded=decisionPayload({intent,dimensions,accepted,options,descriptionMax:70});
  log('query_v2_link_payload',{step,phase:'score',payload:coded.payload});
  const call=await modelJson(client,model,SCORE_SYSTEM,coded.payload,{maxTokens:550}); addUsage(usage,call.usage);
  console.log(`[lemap query-v2][LINK ${step}] SCORE tokens: prompt ${call.usage.prompt} | output ${call.usage.completion} | call ${call.usage.total} | cumulative ${usage.total}`);
  const assessments=decodeSparseDecision(call.parsed,options,dimensions,coded.optionMap,coded.dimensionMap,{omittedDecision:'unassessed'});
  const candidates=ranked(assessments); if(candidates[0])console.log(`  CURRENT: ${candidates[0].name} | ${fmtDims(candidates[0].dimensions)} | score ${candidates[0].confidence.toFixed(2)}`); for(const i of candidates.slice(1))console.log(`  ALT: ${i.name} | ${fmtDims(i.dimensions)} | score ${i.confidence.toFixed(2)}`); for(const i of assessments.filter((x)=>x.decision==='reject'))console.log(`  REJECT: ${i.name}`);
  log('query_v2_link_model',{step,phase:'score',assessments,usage:call.usage,cumulativeUsage:{...usage}}); return assessments;
}

async function inspectEdge({intent,dimensions,accepted,sourceEntity,targetEntity,joins,client,model,log,usage,step}){
  const codec=dimensionCodec(dimensions);
  const payload={i:intent,d:codec.names.map((name,i)=>[i,name]),u:uncoveredDimensionIndexes(accepted,dimensions,codec),a:acceptedSummary(accepted,codec),s:sourceEntity,t:targetEntity,j:joinSummary(joins)};
  log('query_v2_link_payload',{step,phase:'edge',payload});
  const call=await modelJson(client,model,EDGE_SYSTEM,payload,{maxTokens:180}); addUsage(usage,call.usage);
  console.log(`[lemap query-v2][LINK ${step}] EDGE tokens: prompt ${call.usage.prompt} | output ${call.usage.completion} | call ${call.usage.total} | cumulative ${usage.total}`);
  const dims=normalizePairs(call.parsed?.d,codec), map={f:'follow',l:'alternative',r:'reject'}; const result={decision:map[String(call.parsed?.x||'')]||'alternative',dimensions:dims,confidence:confidence(dims)};
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
    const candidates=ranked(assessments); if(!candidates.length)break;
    const frame={current:candidates[0],alternatives:candidates.slice(1)}; stack.push(frame); let current=linkedHierarchy.byId.get(frame.current.id);
    while(current){
      if(current.type!=='entity'){options=current.children;break;}
      const link=byEntity.get(key(current.entityName)); if(!link)break;
      const edge=await inspectEdge({intent,dimensions,accepted,sourceEntity,targetEntity:current.entityName,joins:link.joins,client,model,log,usage,step:++step});
      console.log(`[lemap query-v2][LINK ${step}] ${sourceEntity} → ${current.entityName} ${edge.decision.toUpperCase()} | ${fmtDims(edge.dimensions)} | score ${edge.confidence.toFixed(2)} | cumulative ${usage.total}`);
      if(edge.decision==='follow')return{choice:{entity:current.entityName,joins:link.joins,dimensions:edge.dimensions,confidence:edge.confidence},rejectedEntityKeys,step};
      if(edge.decision==='reject')rejectedEntityKeys.add(key(current.entityName)); else deferred.push({entity:current.entityName,joins:link.joins,dimensions:edge.dimensions,confidence:edge.confidence});
      let next=null; while(stack.length&&!next){const top=stack.at(-1);if(top.alternatives.length){top.current=top.alternatives.shift();next=linkedHierarchy.byId.get(top.current.id);}else stack.pop();}
      if(!next){const best=deferred.sort((a,b)=>b.confidence-a.confidence)[0]||null;return{choice:best,rejectedEntityKeys,step};}
      current=next; if(current.type!=='entity'){options=current.children;break;}
    }
  }
  return{choice:deferred.sort((a,b)=>b.confidence-a.confidence)[0]||null,rejectedEntityKeys,step};
}
