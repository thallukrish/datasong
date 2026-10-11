import crypto from 'node:crypto';

const arr=(value)=>Array.isArray(value)?value:[];

function flowId(symbolIds=[]){
  const basis=arr(symbolIds).join('>');
  return `flowseg:${crypto.createHash('sha1').update(basis).digest('hex').slice(0,12)}`;
}

function executableSymbols(symbols=[]){
  return arr(symbols).filter(symbol=>symbol?.id&&symbol?.executable===true);
}

function callTargets(symbol,byId){
  const seen=new Set();
  const out=[];
  for(const ref of arr(symbol?.references)){
    if(String(ref?.relation||'')!=='calls'||!ref?.targetSymbolId)continue;
    const id=String(ref.targetSymbolId);
    if(!byId.has(id)||seen.has(id))continue;
    seen.add(id);
    out.push(id);
  }
  return out.sort();
}

export function buildCompactCallFlows({symbols=[]}={}){
  const executable=executableSymbols(symbols);
  const byId=new Map(executable.map(symbol=>[symbol.id,symbol]));
  const outgoing=new Map();
  const incoming=new Map(executable.map(symbol=>[symbol.id,[]]));

  for(const symbol of executable){
    const targets=callTargets(symbol,byId);
    outgoing.set(symbol.id,targets);
    for(const targetId of targets){
      incoming.get(targetId).push(symbol.id);
    }
  }

  for(const values of incoming.values())values.sort();

  const visitedEdges=new Set();
  const paths=[];

  const edgeKey=(from,to)=>`${from}→${to}`;

  const emitFromEdge=(startId,nextId)=>{
    const firstKey=edgeKey(startId,nextId);
    if(visitedEdges.has(firstKey))return;

    const symbolIds=[startId];
    let from=startId;
    let current=nextId;

    while(current){
      const key=edgeKey(from,current);
      if(visitedEdges.has(key))break;
      visitedEdges.add(key);
      symbolIds.push(current);

      const inDegree=arr(incoming.get(current)).length;
      const nextTargets=arr(outgoing.get(current));

      // Stop at a structural branch/convergence/sink. The boundary function is
      // intentionally shared between adjacent segments so Query can see both
      // sides of the execution transition.
      if(inDegree!==1||nextTargets.length!==1)break;

      const next=nextTargets[0];
      if(symbolIds.includes(next)){
        const cycleKey=edgeKey(current,next);
        if(!visitedEdges.has(cycleKey))visitedEdges.add(cycleKey);
        break;
      }

      from=current;
      current=next;
    }

    if(symbolIds.length<2)return;
    paths.push({
      id:flowId(symbolIds),
      symbolIds,
      functionCount:symbolIds.length,
      branchVariantCount:1,
      alternateEntranceCount:0,
      compact:true
    });
  };

  // Start at every structural boundary. This covers roots, branches,
  // convergences and the chains between them without enumerating branch
  // combinations.
  for(const symbol of executable.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))){
    const id=symbol.id;
    const inDegree=arr(incoming.get(id)).length;
    const targets=arr(outgoing.get(id));
    if(inDegree===1&&targets.length===1)continue;
    for(const targetId of targets)emitFromEdge(id,targetId);
  }

  // Pure cycles have no boundary, so consume any remaining unvisited edge once.
  for(const symbol of executable.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))){
    for(const targetId of arr(outgoing.get(symbol.id))){
      if(!visitedEdges.has(edgeKey(symbol.id,targetId))){
        emitFromEdge(symbol.id,targetId);
      }
    }
  }

  paths.sort((a,b)=>
    String(a.symbolIds[0]||'').localeCompare(String(b.symbolIds[0]||''))||
    String(a.id).localeCompare(String(b.id))
  );

  return {
    paths,
    functionCount:executable.length,
    edgeCount:[...outgoing.values()].reduce((sum,targets)=>sum+targets.length,0)
  };
}
