import { addUsage, arr, modelJson, text } from '../../query_v2/modelJson.js';
import { materializeCodeStructure, applyCodeSemantics, semanticDetails } from './codeGraph.js';

const MAX_LOOKAHEAD_NODES = 48;

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

function stateForRegion(symbol,region){
  const kind=String(region?.kind||'region');
  const startLine=Number(region?.startLine||symbol.startLine||0);
  return {
    id:region.id,
    regionId:region.id,
    type:'code_region',
    name:`${symbol.name} [${kind} @ ${startLine}]`,
    symbolId:symbol.id,
    sourcePath:symbol.sourcePath||'',
    startLine,
    endLine:Number(region?.endLine||startLine),
    body:String(region?.body||''),
    parent:region?.parentRegionId||symbol.id,
    parentSymbolId:symbol.id,
    kind,
    references:arr(region?.references)
  };
}

function moduleRegionOwner(explorer,sourcePath=''){
  return arr(explorer.topology?.moduleRegions)
    .find(item=>String(item?.sourcePath||'')===String(sourcePath||''))||null;
}

function stateForModuleRegion(owner,region){
  const kind=String(region?.kind||'region');
  const startLine=Number(region?.startLine||0);
  const sourcePath=String(owner?.sourcePath||'');
  return {
    id:region.id,
    regionId:region.id,
    type:'code_region',
    name:`${sourcePath} [${kind} @ ${startLine}]`,
    symbolId:'',
    sourcePath,
    startLine,
    endLine:Number(region?.endLine||startLine),
    body:String(region?.body||''),
    parent:region?.parentRegionId||null,
    parentSymbolId:null,
    kind,
    moduleLevel:true,
    references:arr(region?.references)
  };
}

function structuralRegionStates(state,explorer){
  if(!state||state.type==='code_external'||state.type==='code_region')return[];
  const symbol=explorer.topology?.symbolById?.get(state.symbolId);
  if(!symbol)return[];
  return arr(symbol.regions).map(region=>stateForRegion(symbol,region)).filter(region=>region.id);
}

function structuralRegionChildren(state,explorer){
  if(!state||state.type!=='code_region')return[];
  const symbol=explorer.topology?.symbolById?.get(state.symbolId);
  if(symbol){
    return arr(symbol.regions)
      .filter(region=>String(region?.parentRegionId||'')===String(state.regionId||state.id||''))
      .map(region=>stateForRegion(symbol,region))
      .filter(region=>region.id);
  }
  const owner=moduleRegionOwner(explorer,state.sourcePath);
  if(!owner)return[];
  return arr(owner.regions)
    .filter(region=>String(region?.parentRegionId||'')===String(state.regionId||state.id||''))
    .map(region=>stateForModuleRegion(owner,region))
    .filter(region=>region.id);
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

function descendantRegionRanges(state,explorer){
  if(state?.type!=='code_region')return[];
  const symbol=explorer.topology?.symbolById?.get(state?.symbolId);
  const owner=symbol||moduleRegionOwner(explorer,state?.sourcePath);
  if(!owner)return[];
  const byParent=new Map();
  for(const region of arr(owner.regions)){
    const parent=String(region?.parentRegionId||'');
    if(!byParent.has(parent))byParent.set(parent,[]);
    byParent.get(parent).push(region);
  }
  const out=[],queue=[String(state.regionId||state.id||'')];
  while(queue.length){
    const parent=queue.shift();
    for(const region of arr(byParent.get(parent))){
      const start=Number(region?.startLine||0),end=Number(region?.endLine||start);
      out.push([start,end]);
      queue.push(String(region?.id||''));
    }
  }
  return out;
}

function directCallStates(state,explorer){
  if(state?.type==='code_external')return[];
  const symbol=explorer.topology?.symbolById?.get(state?.symbolId);
  const moduleOwner=!symbol&&state?.type==='code_region'
    ? moduleRegionOwner(explorer,state?.sourcePath)
    : null;
  if(!symbol&&!moduleOwner)return[];

  const topRegions=arr((symbol||moduleOwner).regions).filter(region=>!region?.parentRegionId);
  const nestedRanges=descendantRegionRanges(state,explorer);
  const lineOf=(ref)=>Number(ref?.line||ref?.startLine||0);
  const belongsHere=(ref)=>{
    const line=lineOf(ref);
    if(state?.type==='code_region'){
      if(line<Number(state.startLine||0)||line>Number(state.endLine||0))return false;
      return !nestedRanges.some(([start,end])=>start<=line&&line<=end);
    }
    return !topRegions.some(region=>{
      const start=Number(region?.startLine||0),end=Number(region?.endLine||start);
      return start<=line&&line<=end;
    });
  };
  const refs=symbol?arr(symbol.references):arr(state.references);
  const out=[];
  for(const ref of refs.filter(ref=>ref?.relation==='calls'&&belongsHere(ref))){
    if(ref?.targetSymbolId){
      const target=explorer.topology?.symbolById?.get(ref.targetSymbolId);
      if(target)out.push(stateForSymbol(target,symbol?.id||null));
    }else if(ref?.external&&ref?.resolution==='external_import'){
      const externalOwner=symbol||{
        id:state.id,
        sourcePath:state.sourcePath,
        name:state.name
      };
      out.push(externalStateForRef(externalOwner,ref));
    }
  }
  return out;
}

export function collectLocalSemanticWindow({
  state,explorer,depth=1,includeRootRegions=true,includeCallFrontier=false
}){
  if(!state)return{states:[],links:[]};
  const seen=new Set(),states=[],links=[];
  const add=(node)=>{
    if(!node?.id||seen.has(node.id))return false;
    seen.add(node.id);states.push(node);return true;
  };

  add(state);

  // Regions are semantic evidence containers for every function, regardless
  // of function size. Query still moves one semantic level at a time.
  if(includeRootRegions&&state.type!=='code_external'){
    const maxRegionDepth=Math.max(1,Math.min(3,Number(depth)||1));
    const roots=state.type==='code_region'
      ? structuralRegionChildren(state,explorer)
      : structuralRegionStates(state,explorer)
        .filter(region=>region.parent===state.id||region.parent===state.symbolId);
    const queue=roots.map(region=>({region,parentId:state.id,level:1}));
    const regionSeen=new Set();
    while(queue.length&&states.length<MAX_LOOKAHEAD_NODES){
      const {region,parentId,level}=queue.shift();
      if(!region?.id||regionSeen.has(region.id))continue;
      regionSeen.add(region.id);
      add(region);
      links.push({from:parentId,to:region.id,relationship:'contains'});
      if(level>=maxRegionDepth)continue;
      for(const child of structuralRegionChildren(region,explorer)){
        queue.push({region:child,parentId:region.id,level:level+1});
      }
    }
  }

  // Calls belong to the smallest enclosing semantic container. Materialized
  // regions therefore own calls made directly in their body; nested-region
  // calls do not leak upward to the parent region or function.
  if(includeCallFrontier&&state.type!=='code_external'){
    const maxDepth=Math.max(1,Math.min(3,Number(depth)||1));
    const scopeNodes=states.filter(node=>node.type==='code_symbol'||node.type==='code_region');
    const queue=scopeNodes.map(node=>({node,level:0}));
    const expanded=new Set();
    while(queue.length&&states.length<MAX_LOOKAHEAD_NODES){
      const {node,level}=queue.shift();
      if(!node?.id||expanded.has(node.id)||level>=maxDepth)continue;
      expanded.add(node.id);
      for(const child of directCallStates(node,explorer)){
        if(states.length>=MAX_LOOKAHEAD_NODES)break;
        links.push({from:node.id,to:child.id,relationship:'calls'});
        add(child);
        if(child.type==='code_symbol')queue.push({node:child,level:level+1});
      }
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
    const symbol=explorer.topology?.symbolById?.get(state.symbolId);
    if(state.type==='code_region'){
      if(!learned)regions.push({regionId:state.regionId,symbolId:state.symbolId||'',kind:state.kind||'',sourcePath:state.sourcePath,startLine:state.startLine,endLine:state.endLine,body:text(state.body,3200)});
      continue;
    }
    if(!symbol)continue;
    if(!learned)symbols.push({symbolId:symbol.id,name:symbol.name,signature:symbol.signature||'',sourcePath:symbol.sourcePath||'',startLine:symbol.startLine,endLine:symbol.endLine,body:text(symbol.body,3200)});
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


export async function ensureLocalSemanticWindow({
  state,path=[],depth=1,highlightRegions=[],includeRootRegions=true,includeCallFrontier=false,
  explorer,client,model,usage,log=()=>{},onProgress=()=>{}
}){
  const window=collectLocalSemanticWindow({state,explorer,depth,includeRootRegions,includeCallFrontier});
  const highlights=arr(highlightRegions).filter(Boolean);
  const result=await ensureLocalCodeSemantics({states:[...window.states,...highlights],path,links:window.links,explorer,client,model,usage,log,onProgress});
  return{...result,window:{...window,highlights}};
}
