import { addUsage, arr, modelJson, text } from '../../query_v2/modelJson.js';
import { materializeCodeStructure, applyCodeSemantics, semanticDetails } from './codeGraph.js';

const LEARN_SYSTEM = \`Learn query-independent LOCAL code semantics from supplied deterministic source evidence. Do not answer a user query and do not assign relevance. Return {"symbols":[{"symbolId":"","purpose":"","effect":""}],"regions":[{"regionId":"","purpose":"","effect":""}],"branches":[{"fromSymbolId":"","toSymbolId":"","purpose":"","effect":"","evidenceSourcePath":"","evidenceStartLine":0,"evidenceEndLine":0}]} using only exact supplied IDs.\`;

export function codeSemanticForState(state,explorer){return semanticDetails(explorer,state)}

export async function ensureLocalCodeSemantics({states,explorer,client,model,usage,log=()=>{}}){
  const requested=arr(states).filter(Boolean);materializeCodeStructure(explorer,requested);
  const symbols=[],regions=[];
  for(const state of requested){
    const symbol=explorer.topology?.symbolById?.get(state.symbolId);if(!symbol)continue;
    const learned=!!semanticDetails(explorer,state)?.learned;
    if(state.type==='code_region'&&!learned)regions.push({regionId:state.regionId,symbolId:state.symbolId,kind:state.kind||'',sourcePath:state.sourcePath,startLine:state.startLine,endLine:state.endLine,body:text(state.body,3200)});
    else if(state.type!=='code_region'&&!learned)symbols.push({symbolId:symbol.id,name:symbol.name,signature:symbol.signature||'',sourcePath:symbol.sourcePath||'',startLine:symbol.startLine,endLine:symbol.endLine,body:text(symbol.body,3200)});

  }
  if(!symbols.length&&!regions.length)return{learned:false,reused:requested.length};
  const call=await modelJson(client,model,LEARN_SYSTEM,{symbols,regions},{maxTokens:1200});addUsage(usage,call.usage);
  applyCodeSemantics(explorer,{symbols:call.parsed?.symbols,regions:call.parsed?.regions});
  explorer.persistSemanticMap?.();
  log('code_local_semantics_learned',{symbols:arr(call.parsed?.symbols).length,regions:arr(call.parsed?.regions).length,branches:0,usage:call.usage});
  return{learned:true,usage:call.usage};
}
