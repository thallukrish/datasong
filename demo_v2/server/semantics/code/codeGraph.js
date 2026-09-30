import { arr } from '../../query_v2/modelJson.js';

const clone=(v)=>JSON.parse(JSON.stringify(v));
const graph=(explorer)=>Array.isArray(explorer.state?.learnedGraph)?explorer.state.learnedGraph:[];
const index=(explorer)=>new Map(graph(explorer).filter(n=>n?.id).map(n=>[n.id,n]));
const linkKey=(l)=>[l?.nodeId,l?.relationship].join('|');

function mergeLinks(node,links=[]){
  const seen=new Set(arr(node.links).map(linkKey));node.links=arr(node.links);
  for(const link of links){const k=linkKey(link);if(!seen.has(k)){seen.add(k);node.links.push(link)}}
}
function upsert(explorer,node){
  if(!Array.isArray(explorer.state.learnedGraph))explorer.state.learnedGraph=[];
  const prior=explorer.state.learnedGraph.find(n=>n.id===node.id);
  if(!prior){explorer.state.learnedGraph.push(clone(node));return explorer.state.learnedGraph.at(-1)}
  prior.type=node.type||prior.type;prior.name=node.name||prior.name;
  prior.data={...(prior.data||{}),...(node.data||{}),details:{...(prior.data?.details||{}),...(node.data?.details||{}),structural:{...(prior.data?.details?.structural||{}),...(node.data?.details?.structural||{})},semantic:{...(prior.data?.details?.semantic||{}),...(node.data?.details?.semantic||{})}}};
  mergeLinks(prior,node.links);return prior;
}
export function graphNode(explorer,id){return index(explorer).get(id)||null}

export function materializeCodeStructure(explorer,states=[]){
  const symbolById=explorer.topology?.symbolById;
  for(const state of arr(states)){
    const symbol=symbolById?.get(state.symbolId);
    if(state.type==='code_external'){
      const node=upsert(explorer,{
        id:state.id,type:'external-call',name:state.name,
        data:{details:{structural:{sourcePath:state.sourcePath||'',startLine:Number(state.startLine||0),endLine:Number(state.endLine||state.startLine||0),symbolId:state.symbolId||'',kind:state.boundaryKind||'external-call',signature:'',importModule:state.importModule||'',importName:state.importName||'',qualifiedName:state.qualifiedName||state.name||'',callText:state.callText||'',keywordArgs:arr(state.keywordArgs),reExported:!!state.reExported,scopeKind:state.scopeKind||'',scopeName:state.scopeName||'',targetExternalId:state.targetExternalId||'',viaModule:state.viaModule||''},semantic:{}}},
        links:[]
      });
      if(state.parentSymbolId){
        let parent=graphNode(explorer,state.parentSymbolId);
        if(!parent){
          const ps=symbolById?.get(state.parentSymbolId);
          if(ps)parent=upsert(explorer,{id:ps.id,type:'function',name:ps.name,data:{details:{structural:{sourcePath:ps.sourcePath||'',startLine:Number(ps.startLine||0),endLine:Number(ps.endLine||0),symbolId:ps.id,kind:ps.kind||'',signature:ps.signature||''},semantic:{}}},links:[]});
        }
        if(parent)mergeLinks(parent,[{nodeId:state.id,relationship:'calls'}]);
        mergeLinks(node,[{nodeId:state.parentSymbolId,relationship:'called-by'}]);
      }
      continue;
    }
    if(!symbol)continue;
    const node=upsert(explorer,{
      id:state.id,type:state.type==='code_region'?'function-region':'function',name:state.name,
      data:{details:{structural:{sourcePath:state.sourcePath||symbol.sourcePath||'',startLine:Number(state.startLine||symbol.startLine||0),endLine:Number(state.endLine||symbol.endLine||0),symbolId:state.symbolId,regionId:state.regionId||'',kind:state.kind||symbol.kind||'',signature:symbol.signature||''},semantic:{}}},
      links:[]
    });
    if(state.type==='code_region'){
      const parentId=state.parent||state.symbolId;
      mergeLinks(node,[{nodeId:parentId,relationship:'contained-by'}]);
      let parent=graphNode(explorer,parentId);
      if(!parent&&parentId===state.symbolId){const ps=symbolById?.get(state.symbolId);if(ps)parent=upsert(explorer,{id:ps.id,type:'function',name:ps.name,data:{details:{structural:{sourcePath:ps.sourcePath||'',startLine:Number(ps.startLine||0),endLine:Number(ps.endLine||0),symbolId:ps.id,kind:ps.kind||'',signature:ps.signature||''},semantic:{}}},links:[]});}
      if(parent)mergeLinks(parent,[{nodeId:state.id,relationship:'contains'}]);
    }else if(state.parentSymbolId&&state.parentSymbolId!==state.symbolId){
      let parent=graphNode(explorer,state.parentSymbolId);
      if(!parent){const ps=symbolById?.get(state.parentSymbolId);if(ps)parent=upsert(explorer,{id:ps.id,type:'function',name:ps.name,data:{details:{structural:{sourcePath:ps.sourcePath||'',startLine:Number(ps.startLine||0),endLine:Number(ps.endLine||0),symbolId:ps.id,kind:ps.kind||'',signature:ps.signature||''},semantic:{}}},links:[]});}
      if(parent)mergeLinks(parent,[{nodeId:state.id,relationship:'calls'}]);
    }
  }
  return graph(explorer);
}

export function applyCodeSemantics(explorer,{symbols=[],regions=[],externalCalls=[]}={}){
  for(const item of arr(symbols)){const node=graphNode(explorer,item.symbolId);if(node)node.data.details.semantic={...(node.data.details.semantic||{}),purpose:item.purpose||'',effect:item.effect||'',learned:true}}
  for(const item of arr(regions)){const node=graphNode(explorer,item.regionId);if(node)node.data.details.semantic={...(node.data.details.semantic||{}),purpose:item.purpose||'',effect:item.effect||'',learned:true}}
  for(const item of arr(externalCalls)){const node=graphNode(explorer,item.externalId);if(node)node.data.details.semantic={...(node.data.details.semantic||{}),purpose:item.purpose||'',effect:item.effect||'',learned:true}}
}

export function semanticDetails(explorer,state){return graphNode(explorer,state?.id)?.data?.details?.semantic||null}
