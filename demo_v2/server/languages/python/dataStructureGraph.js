import crypto from 'node:crypto';

const arr=(value)=>Array.isArray(value)?value:[];
const uniq=(values)=>[...new Set(arr(values).filter(Boolean))].sort();
const obsKey=(functionId,variable)=>`${String(functionId||'')}::${String(variable||'')}`;

function leaf(value){
  const parts=String(value||'').split(/[.:/\[\], ]/).filter(Boolean);
  return parts.at(-1)||'';
}

function stableId(prefix,basis){
  return `${prefix}:${crypto.createHash('sha1').update(String(basis||'')).digest('hex').slice(0,12)}`;
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
  const annotations=uniq(
    observations
      .map(item=>String(item?.annotation||'').trim())
      .filter(value=>value&&value!=='Any'&&value!=='typing.Any')
  );
  const constructors=uniq(observations.flatMap(item=>
    arr(item?.origins)
      .filter(origin=>origin?.kind==='constructed'&&origin?.name)
      .map(origin=>String(origin.name).trim())
  ));
  return {annotations,constructors};
}

function entityFamilyKey(observations,kind){
  const {annotations,constructors}=canonicalTypeEvidence(observations);
  if(constructors.length===1)return `constructor:${constructors[0]}`;
  if(annotations.length===1)return `annotation:${annotations[0]}`;

  const keys=uniq(observations.flatMap(item=>arr(item?.keys)));
  if(kind==='mapping'&&keys.length>=2)return `mapping:${keys.join('|')}`;

  return '';
}

function entityName(observations,kind){
  const {annotations,constructors}=canonicalTypeEvidence(observations);
  if(constructors.length===1)return leaf(constructors[0]);
  if(annotations.length===1)return leaf(annotations[0]);

  const aliases=uniq(observations.map(item=>String(item?.variable||'')).filter(Boolean))
    .sort((a,b)=>a.length-b.length||a.localeCompare(b));
  return aliases[0]||kind||'value';
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
  const createLines=new Set(
    events
      .filter(event=>event?.operation==='create')
      .map(event=>Number(event?.line||0))
  );
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

function transfersByResolvedEdge(transfers,symbolById){
  const out=new Map();

  for(const transfer of arr(transfers)){
    const callerId=String(transfer?.callerFunctionId||'');
    const targetId=resolveTransferTarget(transfer,symbolById);
    if(!callerId||!targetId)continue;
    const key=`${callerId}→${targetId}`;
    if(!out.has(key))out.set(key,[]);
    out.get(key).push({...transfer,targetFunctionId:targetId});
  }

  return out;
}

function parameterObservations(functionId,observationByKey){
  return [...observationByKey.values()]
    .filter(obs=>String(obs?.functionId||'')===String(functionId)&&obs?.parameter===true)
    .sort((a,b)=>Number(a?.parameterIndex??999)-Number(b?.parameterIndex??999));
}

function returnedObservations(functionId,observationByKey){
  return [...observationByKey.values()]
    .filter(obs=>String(obs?.functionId||'')===String(functionId)&&obs?.returned===true);
}

function unionAliasesWithinFunctions(uf,functionIds,observationByKey){
  const allowed=new Set(functionIds);

  for(const observation of observationByKey.values()){
    if(!allowed.has(String(observation?.functionId||'')))continue;
    for(const origin of arr(observation?.origins)){
      if(origin?.kind!=='alias'||!origin?.name)continue;
      uf.union(
        obsKey(observation.functionId,observation.variable),
        obsKey(observation.functionId,origin.name)
      );
    }
  }
}

function unionTransfer(uf,transfer,targetId,observationByKey){
  const callerId=String(transfer?.callerFunctionId||'');
  const params=parameterObservations(targetId,observationByKey);

  arr(transfer?.positionalArgs).forEach((variable,index)=>{
    if(!variable||!params[index])return;
    uf.union(
      obsKey(callerId,variable),
      obsKey(targetId,params[index].variable)
    );
  });

  for(const kw of arr(transfer?.keywordArgs)){
    if(!kw?.name||!kw?.variable)continue;
    const param=params.find(item=>String(item?.variable||'')===String(kw.name));
    if(!param)continue;
    uf.union(
      obsKey(callerId,kw.variable),
      obsKey(targetId,param.variable)
    );
  }

  const returned=returnedObservations(targetId,observationByKey);
  for(const resultVariable of arr(transfer?.resultVariables)){
    const receiver=obsKey(callerId,resultVariable);
    for(const returnedObs of returned){
      uf.union(receiver,obsKey(targetId,returnedObs.variable));
    }
  }
}

function componentMap(uf,keys,observationByKey){
  const components=new Map();

  for(const key of keys){
    const observation=observationByKey.get(key);
    if(!observation)continue;
    const root=uf.find(key);
    if(!root)continue;
    if(!components.has(root))components.set(root,[]);
    components.get(root).push(observation);
  }

  return components;
}

function hasShapeEvidence(observations){
  return observations.some(obs=>
    arr(obs?.members).length||
    arr(obs?.methods).length||
    arr(obs?.keys).length||
    arr(obs?.origins).some(origin=>
      ['mapping','sequence','set','container','constructed'].includes(origin?.kind)
    )||
    (obs?.annotation&&String(obs.annotation)!=='Any'&&String(obs.annotation)!=='typing.Any')
  );
}

function componentCrossesBoundary(observations,flowEdges){
  const functionIds=new Set(observations.map(obs=>String(obs?.functionId||'')));
  if(functionIds.size<2)return false;

  for(const edge of flowEdges){
    const [from,to]=edge.split('→');
    if(functionIds.has(from)&&functionIds.has(to))return true;
  }
  return false;
}

function materializeEntity({
  flow,
  observationsInComponent,
  symbolById,
  nodeById,
  entityLinks
}){
  const kind=inferredKind(observationsInComponent);
  const aliases=uniq(observationsInComponent.map(obs=>obs?.variable));
  const members=uniq(observationsInComponent.flatMap(obs=>arr(obs?.members)));
  const methods=uniq(observationsInComponent.flatMap(obs=>arr(obs?.methods)));
  const keys=uniq(observationsInComponent.flatMap(obs=>arr(obs?.keys)));
  const origins=uniq(observationsInComponent.flatMap(originNames));
  const {annotations,constructors}=canonicalTypeEvidence(observationsInComponent);
  const functionIds=uniq(observationsInComponent.map(obs=>obs?.functionId));

  const bindings=observationsInComponent
    .map(obs=>obsKey(obs?.functionId,obs?.variable))
    .sort();
  const id=stableId('entity-instance',`${String(flow?.id||'')}|${bindings.join('|')}`);
  const familyKey=entityFamilyKey(observationsInComponent,kind);
  const familyId=familyKey?stableId('entity-family',familyKey):'';

  let operationCount=0;
  for(const observation of observationsInComponent){
    const symbol=symbolById.get(observation.functionId);
    for(const event of canonicalEvents(observation)){
      operationCount+=1;
      const region=innermostRegion(symbol,Number(event.line||0));
      const sourceId=region?.id||observation.functionId;
      const sourceType=region?'function-region':'function';
      addLink(nodeById.get(sourceId),id,event.relationship);

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
        origin:event.detail||originNames(observation).join('|'),
        flowId:String(flow?.id||''),
        familyId
      });
    }
  }

  const functionCount=functionIds.length;
  const persistenceScore=(functionCount*2)+Math.min(operationCount,20);

  return {
    id,
    type:'entity',
    details:{
      name:entityName(observationsInComponent,kind),
      kind,
      identityScope:'flow-instance',
      identityKey:`flow:${String(flow?.id||'')}:${id}`,
      flowId:String(flow?.id||''),
      aliases,
      annotations,
      constructors,
      origins,
      members,
      methods,
      keys,
      functionCount,
      flowCount:1,
      operationCount,
      persistenceScore,
      coreScore:persistenceScore,
      transient:functionCount<=2,
      familyId,
      familyKey,
      familyInstanceCount:familyId?1:0,
      familyFlowCount:familyId?1:0,
      familyFunctionCount:familyId?functionCount:0,
      familyPersistenceScore:familyId?persistenceScore:0
    },
    links:[]
  };
}

function annotateFamilies(entityNodes){
  const byFamily=new Map();

  for(const node of entityNodes){
    const familyId=String(node?.details?.familyId||'');
    if(!familyId)continue;
    if(!byFamily.has(familyId))byFamily.set(familyId,[]);
    byFamily.get(familyId).push(node);
  }

  for(const [familyId,members] of byFamily.entries()){
    const flowIds=new Set();
    const functionBindings=new Set();
    let operationCount=0;

    for(const node of members){
      if(node.details?.flowId)flowIds.add(String(node.details.flowId));
      operationCount+=Number(node.details?.operationCount||0);
      for(const alias of arr(node.details?.aliases)){
        functionBindings.add(`${String(node.details?.flowId||'')}:${alias}`);
      }
    }

    const familyFunctionCount=members.reduce(
      (sum,node)=>sum+Number(node.details?.functionCount||0),
      0
    );
    const familyPersistenceScore=
      (flowIds.size*4)+
      (familyFunctionCount*2)+
      Math.min(operationCount,40);

    for(const node of members){
      node.details.familyId=familyId;
      node.details.familyInstanceCount=members.length;
      node.details.familyFlowCount=flowIds.size;
      node.details.familyFunctionCount=familyFunctionCount;
      node.details.familyPersistenceScore=familyPersistenceScore;
      node.details.coreScore=
        Number(node.details?.persistenceScore||0)+familyPersistenceScore;
    }
  }
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
    if(!observation?.functionId||!observation?.variable)continue;
    observationByKey.set(
      obsKey(observation.functionId,observation.variable),
      observation
    );
  }

  const transferEdges=transfersByResolvedEdge(transfers,symbolById);
  const entityLinks=[];
  const entityNodes=[];

  for(const flow of arr(flowSlices)){
    const functionIds=arr(flow?.symbolIds).map(String).filter(Boolean);
    if(functionIds.length<2)continue;

    const functionSet=new Set(functionIds);
    const flowKeys=[...observationByKey.entries()]
      .filter(([,obs])=>functionSet.has(String(obs?.functionId||'')))
      .map(([key])=>key);

    if(!flowKeys.length)continue;

    const uf=new UnionFind(flowKeys);
    unionAliasesWithinFunctions(uf,functionIds,observationByKey);

    const flowEdges=[];
    for(let i=0;i<functionIds.length-1;i+=1){
      const from=functionIds[i];
      const to=functionIds[i+1];
      const edge=`${from}→${to}`;
      flowEdges.push(edge);
      for(const transfer of transferEdges.get(edge)||[]){
        unionTransfer(uf,transfer,to,observationByKey);
      }
    }

    const components=componentMap(uf,flowKeys,observationByKey);

    for(const observationsInComponent of components.values()){
      const crossesBoundary=componentCrossesBoundary(
        observationsInComponent,
        flowEdges
      );
      if(!crossesBoundary)continue;

      const entityNode=materializeEntity({
        flow,
        observationsInComponent,
        symbolById,
        nodeById,
        entityLinks
      });

      entityNodes.push(entityNode);
      nodeById.set(entityNode.id,entityNode);
    }
  }

  // Local shape-only observations are retained as local evidence, but they are
  // never joined across functions and never participate in family persistence
  // unless they have strong type/schema evidence.
  const representedBindings=new Set(
    entityNodes.flatMap(node=>
      arr(node.details?.aliases).map(alias=>
        `${String(node.details?.flowId||'')}:${alias}`
      )
    )
  );

  const flowFunctions=new Set(
    arr(flowSlices).flatMap(flow=>arr(flow?.symbolIds).map(String))
  );

  for(const observation of observationByKey.values()){
    if(!flowFunctions.has(String(observation?.functionId||'')))continue;
    if(!hasShapeEvidence([observation]))continue;

    const flowIds=arr(flowSlices)
      .filter(flow=>arr(flow?.symbolIds).map(String).includes(String(observation.functionId)))
      .map(flow=>String(flow.id||''));

    const alreadyRepresented=entityNodes.some(node=>
      arr(node.details?.aliases).includes(observation.variable)&&
      flowIds.includes(String(node.details?.flowId||''))&&
      Number(node.details?.functionCount||0)>1
    );
    if(alreadyRepresented)continue;

    const pseudoFlow={id:`local:${observation.functionId}`,symbolIds:[observation.functionId]};
    const localNode=materializeEntity({
      flow:pseudoFlow,
      observationsInComponent:[observation],
      symbolById,
      nodeById,
      entityLinks
    });
    localNode.details.identityScope='local-shape';
    localNode.details.flowCount=0;
    localNode.details.transient=true;
    entityNodes.push(localNode);
    nodeById.set(localNode.id,localNode);
  }

  annotateFamilies(entityNodes);

  nodes.push(...entityNodes);
  nodes.sort((a,b)=>{
    const rank={entity:0,workflow:1,function:2,'function-region':3};
    const ar=rank[a.type]??9;
    const br=rank[b.type]??9;
    if(ar!==br)return ar-br;
    if(a.type==='entity'){
      return Number(b.details?.coreScore||0)-Number(a.details?.coreScore||0);
    }
    return String(a.details?.name||a.id).localeCompare(
      String(b.details?.name||b.id)
    );
  });

  return {nodes,entityLinks};
}
