import { addUsage, arr, modelJson, text } from '../../query_v2/modelJson.js';
import { materializeCodeStructure, applyCodeSemantics, semanticDetails } from './codeGraph.js';

const LEARN_SYSTEM = `Learn query-independent LOCAL code semantics for newly expanded code nodes. The ordered flowContext contains only semantics already learned for predecessor nodes on the execution path. Use it only to understand how execution arrived at the new node. Do not answer a user query, infer query relevance, or rewrite predecessor semantics. For each supplied new function or function-region, describe the logic performed by that node in this execution context. Return {"symbols":[{"symbolId":"","purpose":"","effect":""}],"regions":[{"regionId":"","purpose":"","effect":""}]} using only exact supplied IDs.`;

export function codeSemanticForState(state,explorer){return semanticDetails(explorer,state)}

function learnedFlowContext(path,explorer){
  return arr(path).map((state,index)=>{
    const semantic=semanticDetails(explorer,state);
    if(!semantic?.learned)return null;
    return {order:index,id:state.id,type:state.type,name:state.name,semantic:{purpose:text(semantic.purpose,700),effect:text(semantic.effect,600)}};
  }).filter(Boolean);
}

export async function ensureLocalCodeSemantics({states,path=[],explorer,client,model,usage,log=()=>{},onProgress=()=>{}}){
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
  const call=await modelJson(client,model,LEARN_SYSTEM,{flowContext,newNodes:{symbols,regions}});addUsage(usage,call.usage);
  applyCodeSemantics(explorer,{symbols:call.parsed?.symbols,regions:call.parsed?.regions});
  explorer.persistSemanticMap?.();
  log('code_local_semantics_learned',{contextNodeIds:flowContext.map(x=>x.id),symbols:arr(call.parsed?.symbols).length,regions:arr(call.parsed?.regions).length,usage:call.usage});
  onProgress({action:'LEARN_DONE',path:arr(path).map(x=>x.name),nodeIds:[...arr(call.parsed?.symbols).map(x=>x.symbolId),...arr(call.parsed?.regions).map(x=>x.regionId)]});
  return{learned:true,reusedContext:flowContext.length,usage:call.usage};
}
