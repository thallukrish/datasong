import { addUsage, arr, modelJson, text } from '../../query_v2/modelJson.js';
import { materializeCodeStructure, applyCodeSemantics, semanticDetails, graphNode } from './codeGraph.js';

const LEARN_SYSTEM = \`Learn query-independent LOCAL code semantics from supplied deterministic source evidence. Do not answer a user query and do not assign relevance. Return {"symbols":[{"symbolId":"","purpose":"","effect":""}],"regions":[{"regionId":"","purpose":"","effect":""}],"branches":[{"fromSymbolId":"","toSymbolId":"","purpose":"","effect":"","evidenceSourcePath":"","evidenceStartLine":0,"evidenceEndLine":0}]} using only exact supplied IDs.\`;

export function codeSemanticForState(state,explorer){return semanticDetails(explorer,state)}

export async function ensureLocalCodeSemantics({states,explorer,client,model,usage,log=()=>{}}){
  const requested=arr(states).filter(Boolean);materializeCodeStructure(explorer,requested);
  const symbols=[],regions=[],edges=[];
  for(const state of requested){
    const symbol=explorer.topology?.symbolById?.get(state.symbolId);if(!symbol)continue;
    const learned=!!semanticDetails(explorer,state)?.learned;
    if(state.type==='code_region'&&!learned)regions.push({regionId:state.regionId,symbolId:state.symbolId,kind:state.kind||'',sourcePath:state.sourcePath,startLine:state.startLine,endLine:state.endLine,body:text(state.body,3200)});
    else if(state.type!=='code_region'&&!learned)symbols.push({symbolId:symbol.id,name:symbol.name,signature:symbol.signature||'',sourcePath:symbol.sourcePath||'',startLine:symbol.startLine,endLine:symbol.endLine,body:text(symbol.body,3200)});
    if(state.type==='code_symbol'&&state.parentSymbolId&&state.parentSymbolId!==state.symbolId){
      const parent=graphNode(explorer,state.parentSymbolId),link=arr(parent?.links).find(l=>l.nodeId===state.symbolId&&l.relationship==='calls');
      if(link&&!link.data?.semantic)edges.push({fromSymbolId:state.parentSymbolId,toSymbolId:state.symbolId});
    }
  }
  if(!symbols.length&&!regions.length&&!edges.length)return{learned:false,reused:requested.length};
  const call=await modelJson(client,model,LEARN_SYSTEM,{symbols,regions,branches:edges},{maxTokens:1200});addUsage(usage,call.usage);
  const validBranches=arr(call.parsed?.branches).filter(x=>edges.some(e=>e.fromSymbolId===x?.fromSymbolId&&e.toSymbolId===x?.toSymbolId));
  applyCodeSemantics(explorer,{symbols:call.parsed?.symbols,regions:call.parsed?.regions,branches:validBranches});
  explorer.persistSemanticMap?.();
  log('code_local_semantics_learned',{symbols:arr(call.parsed?.symbols).length,regions:arr(call.parsed?.regions).length,branches:validBranches.length,usage:call.usage});
  return{learned:true,usage:call.usage};
}
