import crypto from 'node:crypto';

const arr=(value)=>Array.isArray(value)?value:[];
const uniq=(values)=>[...new Set(arr(values).filter(Boolean))].sort();
const obsKey=(functionId,variable)=>`${String(functionId||'')}::${String(variable||'')}`;

function leaf(value){
  const parts=String(value||'').split(/[.:/\[\], ]/).filter(Boolean);
  return parts.at(-1)||'';
}

function addLink(node,id,relationship){
  if(!node||!id||!relationship)return;
  node.links=arr(node.links);
  if(!node.links.some(link=>link.id===id&&link.relationship===relationship)){
    node.links.push({id,relationship});
  }
}

class UnionFind{
  constructor(keys=[]){
    this.parent=new Map(keys.map(key=>[key,key]));
  }
  has(key){ return this.parent.has(key); }
  add(key){ if(!this.parent.has(key))this.parent.set(key,key); }
  find(key){
    if(!this.parent.has(key))return '';
    const parent=this.parent.get(key);
    if(parent===key)return key;
    const root=this.find(parent);
    this.parent.set(key,root);
    return root;
  }
  union(a,b){
    if(!this.has(a)||!this.has(b))return false;
    const ra=this.find(a), rb=this.find(b);
    if(!ra||!rb||ra===rb)return false;
    const keep=ra<rb?ra:rb;
    const drop=keep===ra?rb:ra;
    this.parent.set(drop,keep);
    return true;
  }
}

function originNames(observation){
  return uniq(arr(observation?.origins).map(origin=>origin?.name).filter(Boolean));
}

function inferredKind(observations){
  const kinds=new Set(observations.map(item=>String(item?.kind||'')).filter(Boolean));
  if(kinds.has('mapping'))return 'mapping';
  if(kinds.has('array-like'))return 'array-like';
  if(kinds.has('sequence'))return 'sequence';
  if(kinds.has('set'))return 'set';
  const primitiveAnnotations=new Set(['int','float','str','bool','bytes','bytearray','complex']);
  const annotations=uniq(observations.map(item=>String(item?.annotation||'')).filter(Boolean));
  if(annotations.length&&annotations.every(value=>primitiveAnnotations.has(value)))return 'primitive';
  return [...kinds][0]||'value';
}

function canonicalTypeEvidence(observations){
  const annotations=uniq(observations.map(item=>String(item?.annotation||'')).filter(Boolean));
  const constructors=uniq(observations.flatMap(item=>
    arr(item?.origins)
      .filter(origin=>origin?.kind==='constructed'&&origin?.name)
      .map(origin=>String(origin.name))
  ));
  return {annotations,constructors};
}

function entityName(observations,kind){
  const {annotations,constructors}=canonicalTypeEvidence(observations);
  if(annotations.length)return leaf(annotations[0]);
  if(constructors.length)return leaf(constructors[0]);
  const aliases=uniq(observations.map(item=>String(item?.variable||'')).filter(Boolean))
    .sort((a,b)=>a.length-b.length||a.localeCompare(b));
  return aliases[0]||kind||'value';
}

function entityId(observations,flowIds){
  const bindings=observations
    .map(item=>obsKey(item?.functionId,item?.variable))
    .filter(Boolean)
    .sort();
  const basis=[...bindings,...uniq(flowIds)].join('|');
  return `entity:${crypto.createHash('sha1').update(basis).digest('hex').slice(0,12)}`;
}

function innermostRegion(symbol,line){
  if(!symbol||!line)return null;
  const candidates=arr(symbol.regions).filter(region=>
    Number(region?.startLine||0)<=line&&line<=Number(region?.endLine||0)
  );
  candidates.sort((a,b)=>{
    const aspan=Number(a?.endLine||0)-Number(a?.startLine||0);
    const bspan=Number(b?.endLine||0)-Number(b?.startLine||0);
    return aspan-bspan||Number(b?.startLine||0)-Number(a?.startLine||0);
  });
  return candidates[0]||null;
}

function eventRelationship(event){
  const op=String(event?.operation||'');
  if(op==='create')return 'create';
  if(op==='mutate'||op==='write')return 'update';
  if(op==='read'||op==='index')return 'read';
  return '';
}

function canonicalEvents(observation){
  const events=arr(observation?.events);
  const createLines=new Set(events.filter(event=>event?.operation==='create').map(event=>Number(event?.line||0)));
  const seen=new Set();
  const out=[];
  for(const event of events){
    const relationship=eventRelationship(event);
    if(!relationship)continue;
    const line=Number(event?.line||0);
    if(relationship==='update'&&createLines.has(line))continue;
    const key=`${relationship}:${line}:${Number(event?.endLine||line)}`;
    if(seen.has(key))continue;
    seen.add(key);
    out.push({...event,relationship});
  }
  return out;
}

function buildFunctionNodes(symbols){
  const nodes=[];
  const nodeById=new Map();
  for(const symbol of arr(symbols)){
    const functionNode={
      id:symbol.id,
      type:'function',
      details:{
        name:symbol.name,
        sourcePath:symbol.sourcePath,
        startLine:Number(symbol.startLine||0),
        endLine:Number(symbol.endLine||0)
      },
      links:[]
    };
    nodes.push(functionNode);
    nodeById.set(functionNode.id,functionNode);

    for(const region of arr(symbol.regions)){
      const regionNode={
        id:region.id,
        type:'function-region',
        details:{
          name:`${symbol.name} ${region.kind||'region'}`,
          functionId:symbol.id,
          kind:region.kind||'',
          sourcePath:symbol.sourcePath,
          startLine:Number(region.startLine||0),
          endLine:Number(region.endLine||0)
        },
        links:[]
      };
      nodes.push(regionNode);
      nodeById.set(regionNode.id,regionNode);
      addLink(functionNode,regionNode.id,'contains');
      addLink(regionNode,symbol.id,'contained-by');
    }
  }

  for(const symbol of arr(symbols)){
    const fn=nodeById.get(symbol.id);
    for(const ref of arr(symbol.references)){
      if(ref?.relation==='calls'&&ref?.targetSymbolId&&nodeById.has(ref.targetSymbolId)){
        addLink(fn,ref.targetSymbolId,'calls');
      }
    }
  }
  return {nodes,nodeById};
}

function flowMembership(flowSlices=[]){
  const edgeFlows=new Map();
  const functionFlows=new Map();
  for(const flow of arr(flowSlices)){
    const ids=arr(flow?.symbolIds);
    for(const id of ids){
      if(!functionFlows.has(id))functionFlows.set(id,new Set());
      functionFlows.get(id).add(String(flow.id||''));
    }
    for(let i=0;i<ids.length-1;i+=1){
      const key=`${ids[i]}→${ids[i+1]}`;
      if(!edgeFlows.has(key))edgeFlows.set(key,new Set());
      edgeFlows.get(key).add(String(flow.id||''));
    }
  }
  return {edgeFlows,functionFlows};
}

function resolveTransferTarget(transfer,symbolById){
  const caller=symbolById.get(transfer?.callerFunctionId);
  if(!caller)return '';
  const line=Number(transfer?.line||0);
  const refs=arr(caller.references).filter(ref=>
    ref?.relation==='calls'&&ref?.targetSymbolId&&
    (!line||Number(ref?.line||0)===line)
  );
  if(refs.length===1)return String(refs[0].targetSymbolId);
  const targetName=String(transfer?.targetName||'').split('.').at(-1);
  const byName=refs.filter(ref=>
    String(ref?.simpleName||ref?.name||'').split('.').at(-1)===targetName
  );
  return byName.length===1?String(byName[0].targetSymbolId):'';
}

export function buildPythonDataStructureGraph({
  symbols=[],
  observations=[],
  transfers=[],
  flowSlices=[]
}={}){
  const {nodes,nodeById}=buildFunctionNodes(symbols);
  const symbolById=new Map(arr(symbols).map(symbol=>[symbol?.id,symbol]));
  const observationByKey=new Map();
  for(const observation of arr(observations)){
    const key=obsKey(observation?.functionId,observation?.variable);
    if(!observation?.functionId||!observation?.variable)continue;
    observationByKey.set(key,observation);
  }

  const uf=new UnionFind([...observationByKey.keys()]);
  const {edgeFlows,functionFlows}=flowMembership(flowSlices);
  const boundaryEvidence=new Map();
  const touchBoundary=(key,flowIds=[])=>{
    if(!key||!uf.has(key))return;
    if(!boundaryEvidence.has(key))boundaryEvidence.set(key,new Set());
    for(const flowId of flowIds)if(flowId)boundaryEvidence.get(key).add(flowId);
  };

  // Same-function aliases are deterministic assignments such as b = a.
  for(const observation of observationByKey.values()){
    for(const origin of arr(observation?.origins)){
      if(origin?.kind!=='alias'||!origin?.name)continue;
      const other=obsKey(observation.functionId,origin.name);
      if(uf.has(other))uf.union(obsKey(observation.functionId,observation.variable),other);
    }
  }

  // Join values only through resolved call boundaries that are present in the
  // compact flow graph: caller argument -> callee parameter and callee return
  // -> caller receiver.
  for(const transfer of arr(transfers)){
    const callerId=String(transfer?.callerFunctionId||'');
    const targetId=resolveTransferTarget(transfer,symbolById);
    if(!callerId||!targetId)continue;
    const edgeKey=`${callerId}→${targetId}`;
    const flows=[...(edgeFlows.get(edgeKey)||[])];
    if(!flows.length)continue;

    const targetParams=[...observationByKey.values()]
      .filter(obs=>String(obs?.functionId||'')===targetId&&obs?.parameter===true)
      .sort((a,b)=>Number(a?.parameterIndex??999)-Number(b?.parameterIndex??999));

    arr(transfer?.positionalArgs).forEach((variable,index)=>{
      if(!variable||!targetParams[index])return;
      const from=obsKey(callerId,variable);
      const to=obsKey(targetId,targetParams[index].variable);
      if(uf.union(from,to)){ touchBoundary(from,flows); touchBoundary(to,flows); }
      else { touchBoundary(from,flows); touchBoundary(to,flows); }
    });

    for(const kw of arr(transfer?.keywordArgs)){
      if(!kw?.name||!kw?.variable)continue;
      const param=targetParams.find(item=>String(item?.variable||'')===String(kw.name));
      if(!param)continue;
      const from=obsKey(callerId,kw.variable);
      const to=obsKey(targetId,param.variable);
      uf.union(from,to);
      touchBoundary(from,flows); touchBoundary(to,flows);
    }

    const returned=[...observationByKey.values()]
      .filter(obs=>String(obs?.functionId||'')===targetId&&obs?.returned===true);
    for(const resultVariable of arr(transfer?.resultVariables)){
      const receiver=obsKey(callerId,resultVariable);
      for(const returnedObs of returned){
        const source=obsKey(targetId,returnedObs.variable);
        uf.union(receiver,source);
        touchBoundary(receiver,flows); touchBoundary(source,flows);
      }
    }
  }

  const components=new Map();
  for(const [key,observation] of observationByKey.entries()){
    const root=uf.find(key);
    if(!components.has(root))components.set(root,[]);
    components.get(root).push(observation);
  }

  const entityLinks=[];
  const entityNodes=[];

  for(const observationsInComponent of components.values()){
    const bindingKeys=observationsInComponent.map(obs=>obsKey(obs.functionId,obs.variable));
    const componentFlowIds=new Set();
    let hasBoundary=false;
    for(const key of bindingKeys){
      const root=uf.find(key);
      for(const [candidate,evidence] of boundaryEvidence.entries()){
        if(uf.find(candidate)!==root)continue;
        hasBoundary=true;
        for(const flowId of evidence)componentFlowIds.add(flowId);
      }
      for(const flowId of functionFlows.get(observationByKey.get(key)?.functionId)||[]){
        if(hasBoundary)componentFlowIds.add(flowId);
      }
    }

    const hasShape=observationsInComponent.some(obs=>
      arr(obs?.members).length||arr(obs?.methods).length||arr(obs?.keys).length||
      arr(obs?.origins).some(origin=>['mapping','sequence','set','container','constructed'].includes(origin?.kind))||
      (obs?.annotation&&String(obs.annotation)!=='Any')
    );
    if(!hasBoundary&&!hasShape)continue;

    const functionIds=uniq(observationsInComponent.map(obs=>obs?.functionId));
    const kind=inferredKind(observationsInComponent);
    const id=entityId(observationsInComponent,[...componentFlowIds]);
    const aliases=uniq(observationsInComponent.map(obs=>obs?.variable));
    const members=uniq(observationsInComponent.flatMap(obs=>arr(obs?.members)));
    const methods=uniq(observationsInComponent.flatMap(obs=>arr(obs?.methods)));
    const keys=uniq(observationsInComponent.flatMap(obs=>arr(obs?.keys)));
    const origins=uniq(observationsInComponent.flatMap(originNames));
    const {annotations,constructors}=canonicalTypeEvidence(observationsInComponent);

    let operationCount=0;
    for(const observation of observationsInComponent){
      const symbol=symbolById.get(observation.functionId);
      for(const event of canonicalEvents(observation)){
        operationCount+=1;
        const region=innermostRegion(symbol,Number(event.line||0));
        const sourceId=region?.id||observation.functionId;
        const sourceType=region?'function-region':'function';
        const sourceNode=nodeById.get(sourceId);
        addLink(sourceNode,id,event.relationship);
        entityLinks.push({
          sourceId,
          sourceType,
          relationship:event.relationship,
          targetId:id,
          targetType:'entity',
          functionId:observation.functionId,
          regionId:region?.id||'',
          sourcePath:observation.sourcePath||symbol?.sourcePath||'',
          startLine:Number(event.line||0),
          endLine:Number(event.endLine||event.line||0),
          variable:observation.variable||'',
          origin:event.detail||originNames(observation).join('|')
        });
      }
    }

    const flowCount=componentFlowIds.size;
    const functionCount=functionIds.length;
    const persistenceScore=(functionCount*2)+(flowCount*3)+Math.min(operationCount,20);
    const entityNode={
      id,
      type:'entity',
      details:{
        name:entityName(observationsInComponent,kind),
        kind,
        identityScope:hasBoundary?'flow':'local-shape',
        identityKey:hasBoundary?`flow-lineage:${id}`:`local-shape:${id}`,
        aliases,
        annotations,
        constructors,
        origins,
        members,
        methods,
        keys,
        functionCount,
        flowCount,
        operationCount,
        persistenceScore,
        coreScore:persistenceScore,
        transient:functionCount<=2&&flowCount<=1
      },
      links:[]
    };
    entityNodes.push(entityNode);
    nodeById.set(id,entityNode);
  }

  nodes.push(...entityNodes);
  nodes.sort((a,b)=>{
    const rank={entity:0,workflow:1,function:2,'function-region':3};
    const ar=rank[a.type]??9, br=rank[b.type]??9;
    if(ar!==br)return ar-br;
    if(a.type==='entity')return Number(b.details?.persistenceScore||0)-Number(a.details?.persistenceScore||0);
    return String(a.details?.name||a.id).localeCompare(String(b.details?.name||b.id));
  });

  return {nodes,entityLinks};
}
