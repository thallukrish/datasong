import { addUsage, arr, modelJson, text } from '../../query_v2/modelJson.js';
import { materializeCodeStructure, applyCodeSemantics, semanticDetails } from './codeGraph.js';

const LEARN_SYSTEM = `Learn query-independent semantics for the supplied local execution window. flowContext contains only already-learned predecessor semantics. newNodes contains raw repository code plus deterministic call relationships, and may also contain terminal externalCalls for imported APIs whose implementation is outside the repository.

Describe what each supplied function, function-region, or external call does and its execution effect. For externalCalls, use only the supplied import identity and call-site syntax. Explain the local meaning of invoking that imported API here; do not invent or claim knowledge of the dependency implementation beyond what the import name and call syntax support. External calls are terminal boundaries, not repository code to traverse.

Do not answer a user query, infer query relevance, rank branches, or rewrite predecessor semantics. Return one semantic result for every supplied new node as {"symbols":[{"symbolId":"","purpose":"","effect":""}],"regions":[{"regionId":"","purpose":"","effect":""}],"externalCalls":[{"externalId":"","purpose":"","effect":""}]} using only exact supplied IDs.`;

export function codeSemanticForState(state,explorer){return semanticDetails(explorer,state)}

function learnedFlowContext(path,explorer){
  return arr(path).map((state,index)=>{
    const semantic=semanticDetails(explorer,state);
    if(!semantic?.learned)return null;
    return {order:index,id:state.id,type:state.type,name:state.name,semantic:{purpose:text(semantic.purpose,700),effect:text(semantic.effect,600)}};
  }).filter(Boolean);
}

function stateForSymbol(symbol,parentSymbolId=null){
  return {id:symbol.id,type:'code_symbol',name:symbol.name,symbolId:symbol.id,sourcePath:symbol.sourcePath||'',startLine:symbol.startLine||0,endLine:symbol.endLine||0,body:String(symbol.body||''),parent:parentSymbolId,parentSymbolId};
}

function externalStateForRef(symbol,ref){
  const line=Number(ref?.line||ref?.startLine||0),endLine=Number(ref?.endLine||line);
  const qualified=String(ref?.qualifiedName||ref?.name||ref?.simpleName||'external');
  return {
    id:`external-call:${symbol.id}:${line}:${qualified}`,
    type:'code_external',
    name:qualified,
    symbolId:'',
    sourcePath:symbol.sourcePath||'',
    startLine:line,
    endLine,
    body:String(ref?.callText||ref?.name||''),
    parent:symbol.id,
    parentSymbolId:symbol.id,
    importModule:String(ref?.importModule||''),
    importName:String(ref?.importName||ref?.simpleName||''),
    qualifiedName:qualified,
    callText:String(ref?.callText||''),
    keywordArgs:arr(ref?.keywordArgs)
  };
}

function directCallStates(state,explorer){
  if(state?.type==='code_external')return[];
  const symbol=explorer.topology?.symbolById?.get(state?.symbolId);if(!symbol)return[];
  const region=state?.type==='code_region'?{start:Number(state.startLine||0),end:Number(state.endLine||0)}:null;
  const inRegion=(ref)=>!region||(Number(ref.line||ref.startLine||0)>=region.start&&Number(ref.line||ref.startLine||0)<=region.end);
  const out=[];
  for(const ref of arr(symbol.references).filter(ref=>ref?.relation==='calls'&&inRegion(ref))){
    if(ref?.targetSymbolId){
      const target=explorer.topology?.symbolById?.get(ref.targetSymbolId);
      if(target)out.push(stateForSymbol(target,symbol.id));
    }else if(ref?.external&&ref?.resolution==='external_import'){
      out.push(externalStateForRef(symbol,ref));
    }
  }
  return out;
}

export function collectLocalSemanticWindow({state,explorer,depth=3}){
  if(!state)return{states:[],links:[]};
  const queue=[{state,level:0}],seen=new Set(),states=[],links=[];
  while(queue.length){
    const current=queue.shift(),node=current.state;if(!node||seen.has(node.id))continue;
    seen.add(node.id);states.push(node);
    if(current.level>=Math.max(0,Number(depth)||0))continue;
    for(const child of directCallStates(node,explorer)){
      links.push({from:node.id,to:child.id,relationship:'calls'});
      if(!seen.has(child.id))queue.push({state:child,level:current.level+1});
    }
  }
  return{states,links};
}

export async function ensureLocalCodeSemantics({states,path=[],links=[],explorer,client,model,usage,log=()=>{},onProgress=()=>{}}){
  const requested=arr(states).filter(Boolean);materializeCodeStructure(explorer,[...arr(path),...requested]);
  const flowContext=learnedFlowContext(path,explorer),symbols=[],regions=[],externalCalls=[];
  for(const state of requested){
    const learned=!!semanticDetails(explorer,state)?.learned;
    if(state.type==='code_external'){
      if(!learned)externalCalls.push({externalId:state.id,name:state.name,sourcePath:state.sourcePath,startLine:state.startLine,endLine:state.endLine,importModule:state.importModule||'',importName:state.importName||'',qualifiedName:state.qualifiedName||state.name||'',callText:text(state.callText||state.body,1200),keywordArgs:arr(state.keywordArgs),reExported:!!state.reExported,boundaryKind:state.boundaryKind||'external-call'});
      continue;
    }
    const symbol=explorer.topology?.symbolById?.get(state.symbolId);if(!symbol)continue;
    if(state.type==='code_region'&&!learned)regions.push({regionId:state.regionId,symbolId:state.symbolId,kind:state.kind||'',sourcePath:state.sourcePath,startLine:state.startLine,endLine:state.endLine,body:text(state.body,3200)});
    else if(state.type!=='code_region'&&!learned)symbols.push({symbolId:symbol.id,name:symbol.name,signature:symbol.signature||'',sourcePath:symbol.sourcePath||'',startLine:symbol.startLine,endLine:symbol.endLine,body:text(symbol.body,3200)});
  }
  if(!symbols.length&&!regions.length&&!externalCalls.length)return{learned:false,reused:requested.length};
  onProgress({action:'LEARN_START',path:arr(path).map(x=>x.name),nodes:[...symbols.map(x=>({id:x.symbolId,name:x.name||x.symbolId})),...regions.map(x=>({id:x.regionId,name:x.regionId})),...externalCalls.map(x=>({id:x.externalId,name:x.qualifiedName||x.name||x.externalId}))]});
  const call=await modelJson(client,model,LEARN_SYSTEM,{flowContext,newNodes:{symbols,regions,externalCalls,links:arr(links)}});addUsage(usage,call.usage);
  applyCodeSemantics(explorer,{symbols:call.parsed?.symbols,regions:call.parsed?.regions,externalCalls:call.parsed?.externalCalls});
  explorer.persistSemanticMap?.();
  log('code_local_semantics_learned',{contextNodeIds:flowContext.map(x=>x.id),symbols:arr(call.parsed?.symbols).length,regions:arr(call.parsed?.regions).length,externalCalls:arr(call.parsed?.externalCalls).length,usage:call.usage});
  onProgress({action:'LEARN_DONE',path:arr(path).map(x=>x.name),nodeIds:[...arr(call.parsed?.symbols).map(x=>x.symbolId),...arr(call.parsed?.regions).map(x=>x.regionId),...arr(call.parsed?.externalCalls).map(x=>x.externalId)]});
  return{learned:true,reusedContext:flowContext.length,usage:call.usage};
}


export async function ensureLocalSemanticWindow({state,path=[],depth=3,highlightRegions=[],explorer,client,model,usage,log=()=>{},onProgress=()=>{}}){
  const window=collectLocalSemanticWindow({state,explorer,depth});
  const highlights=arr(highlightRegions).filter(Boolean);
  const result=await ensureLocalCodeSemantics({states:[...window.states,...highlights],path,links:window.links,explorer,client,model,usage,log,onProgress});
  return{...result,window:{...window,highlights}};
}
