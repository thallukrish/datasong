import { addUsage, arr, modelJson, text } from '../../query_v2/modelJson.js';
import { materializeCodeStructure, applyCodeSemantics, semanticDetails } from './codeGraph.js';

const LEARN_SYSTEM = `Learn query-independent semantics for the supplied local execution window. flowContext contains only already-learned predecessor semantics. newNodes contains raw code only for nodes whose semantics are still unknown, plus deterministic call relationships inside the local window. Describe what each supplied function or function-region does and its execution effect. Do not answer a user query, infer query relevance, rank branches, or rewrite predecessor semantics. Return one semantic result for every supplied new node as {"symbols":[{"symbolId":"","purpose":"","effect":""}],"regions":[{"regionId":"","purpose":"","effect":""}]} using only exact supplied IDs.`;

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

function directCallStates(state,explorer){
  const symbol=explorer.topology?.symbolById?.get(state?.symbolId);if(!symbol)return[];
  const region=state?.type==='code_region'?{start:Number(state.startLine||0),end:Number(state.endLine||0)}:null;
  return arr(symbol.references).filter(ref=>ref?.relation==='calls'&&ref?.targetSymbolId&&(!region||(Number(ref.line||ref.startLine||0)>=region.start&&Number(ref.line||ref.startLine||0)<=region.end))).map(ref=>explorer.topology?.symbolById?.get(ref.targetSymbolId)).filter(Boolean).map(target=>stateForSymbol(target,symbol.id));
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
  const flowContext=learnedFlowContext(path,explorer),symbols=[],regions=[];
  for(const state of requested){
    const symbol=explorer.topology?.symbolById?.get(state.symbolId);if(!symbol)continue;
    const learned=!!semanticDetails(explorer,state)?.learned;
    if(state.type==='code_region'&&!learned)regions.push({regionId:state.regionId,symbolId:state.symbolId,kind:state.kind||'',sourcePath:state.sourcePath,startLine:state.startLine,endLine:state.endLine,body:text(state.body,3200)});
    else if(state.type!=='code_region'&&!learned)symbols.push({symbolId:symbol.id,name:symbol.name,signature:symbol.signature||'',sourcePath:symbol.sourcePath||'',startLine:symbol.startLine,endLine:symbol.endLine,body:text(symbol.body,3200)});
  }
  if(!symbols.length&&!regions.length)return{learned:false,reused:requested.length};
  onProgress({action:'LEARN_START',path:arr(path).map(x=>x.name),nodes:[...symbols.map(x=>({id:x.symbolId,name:x.name||x.symbolId})),...regions.map(x=>({id:x.regionId,name:x.regionId}))]});
  const call=await modelJson(client,model,LEARN_SYSTEM,{flowContext,newNodes:{symbols,regions,links:arr(links)}});addUsage(usage,call.usage);
  applyCodeSemantics(explorer,{symbols:call.parsed?.symbols,regions:call.parsed?.regions});
  explorer.persistSemanticMap?.();
  log('code_local_semantics_learned',{contextNodeIds:flowContext.map(x=>x.id),symbols:arr(call.parsed?.symbols).length,regions:arr(call.parsed?.regions).length,usage:call.usage});
  onProgress({action:'LEARN_DONE',path:arr(path).map(x=>x.name),nodeIds:[...arr(call.parsed?.symbols).map(x=>x.symbolId),...arr(call.parsed?.regions).map(x=>x.regionId)]});
  return{learned:true,reusedContext:flowContext.length,usage:call.usage};
}


export async function ensureLocalSemanticWindow({state,path=[],depth=3,explorer,client,model,usage,log=()=>{},onProgress=()=>{}}){
  const window=collectLocalSemanticWindow({state,explorer,depth});
  const result=await ensureLocalCodeSemantics({states:window.states,path,links:window.links,explorer,client,model,usage,log,onProgress});
  return{...result,window};
}
