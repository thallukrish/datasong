import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';
import { branchSemanticKey, mergeBranchSemantics } from './queryDrivenSemanticFrontier.js';

const LEARN_SYSTEM = \`Learn query-independent LOCAL code semantics from supplied deterministic source evidence. Do not answer a user query and do not assign relevance. Return {"symbols":[{"symbolId":"","purpose":"","effect":""}],"regions":[{"regionId":"","purpose":"","effect":""}],"branches":[{"fromSymbolId":"","toSymbolId":"","purpose":"","effect":"","evidenceSourcePath":"","evidenceStartLine":0,"evidenceEndLine":0}]} using only exact supplied IDs.\`;

function mergeById(existing={},items=[],idField){
  const out={...(existing||{})};
  for(const item of arr(items)){const id=String(item?.[idField]||'').trim(),purpose=text(item?.purpose,700);if(id&&purpose)out[id]={...item,[idField]:id,purpose,effect:text(item?.effect,600)}}
  return out;
}

export function codeSemanticForState(state, semanticState={}){
  if(state?.type==='code_region')return semanticState.codeRegionSemantics?.[state.regionId]||null;
  return semanticState.codeSymbolSemantics?.[state?.symbolId]||null;
}

export async function ensureLocalCodeSemantics({states,explorer,client,model,usage,log=()=>{}}){
  const requested=arr(states).filter(Boolean), symbols=[], regions=[], edges=[];
  for(const state of requested){
    const symbol=explorer.topology?.symbolById?.get(state.symbolId);
    if(!symbol)continue;
    if(state.type==='code_region'){
      if(!explorer.state.codeRegionSemantics?.[state.regionId])regions.push({regionId:state.regionId,symbolId:state.symbolId,kind:state.kind||'',sourcePath:state.sourcePath,startLine:state.startLine,endLine:state.endLine,body:text(state.body,3200)});
    }else if(!explorer.state.codeSymbolSemantics?.[state.symbolId]){
      symbols.push({symbolId:symbol.id,name:symbol.name,signature:symbol.signature||'',sourcePath:symbol.sourcePath||'',startLine:symbol.startLine,endLine:symbol.endLine,body:text(symbol.body,3200)});
    }
    if(state.type==='code_symbol'&&state.parentSymbolId&&state.parentSymbolId!==state.symbolId){
      const key=branchSemanticKey(state.parentSymbolId,state.symbolId);
      if(!explorer.state.codeBranchSemantics?.[key])edges.push({fromSymbolId:state.parentSymbolId,toSymbolId:state.symbolId});
    }
  }
  if(!symbols.length&&!regions.length&&!edges.length)return {learned:false,reused:requested.length};
  const call=await modelJson(client,model,LEARN_SYSTEM,{symbols,regions,branches:edges},{maxTokens:1200});addUsage(usage,call.usage);
  explorer.state.codeSymbolSemantics=mergeById(explorer.state.codeSymbolSemantics,call.parsed?.symbols,'symbolId');
  explorer.state.codeRegionSemantics=mergeById(explorer.state.codeRegionSemantics,call.parsed?.regions,'regionId');
  explorer.state.codeBranchSemantics=mergeBranchSemantics(explorer.state.codeBranchSemantics,call.parsed?.branches);
  explorer.persistSemanticMap?.();
  log('code_local_semantics_learned',{symbols:arr(call.parsed?.symbols).length,regions:arr(call.parsed?.regions).length,branches:arr(call.parsed?.branches).length,usage:call.usage});
  return {learned:true,usage:call.usage};
}
