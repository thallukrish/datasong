import crypto from 'node:crypto';

const arr=(value)=>Array.isArray(value)?value:[];
const uniq=(values)=>[...new Set(arr(values).filter(Boolean))].sort();
const obsKey=(functionId,variable)=>`${String(functionId||'')}::${String(variable||'')}`;

function stableId(prefix,basis){
  return `${prefix}:${crypto.createHash('sha1').update(String(basis||'')).digest('hex').slice(0,12)}`;
}

function leaf(value){
  const parts=String(value||'').split(/[.:/\[\], |]/).filter(Boolean);
  return parts.at(-1)||'';
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

function classCatalog(codeFacts=[],externalSymbols=[]){
  const localByName=new Map();
  for(const fact of arr(codeFacts)){
    if(String(fact?.type||'')!=='class'||!fact?.name)continue;
    const name=String(fact.name);
    const id=`class:${fact.sourcePath}#${name}@${Number(fact.startLine||0)}`;
    if(!localByName.has(name))localByName.set(name,[]);
    localByName.get(name).push({id,name,sourcePath:String(fact.sourcePath||'')});
  }

  const externalSymbolBySource=new Map();
  const moduleAliasBySource=new Map();

  for(const symbol of arr(externalSymbols)){
    const kind=String(symbol?.kind||'');
    const sourcePath=String(symbol?.sourcePath||'');
    const local=String(symbol?.localName||symbol?.simpleName||'').trim();
    const qualified=String(symbol?.qualifiedName||symbol?.name||'').trim();
    if(!sourcePath||!local||!qualified)continue;

    const key=`${sourcePath}::${local}`;
    if(kind==='external-module'){
      moduleAliasBySource.set(key,String(symbol?.importModule||qualified));
      continue;
    }
    if(kind==='external-symbol'){
      externalSymbolBySource.set(key,qualified);
    }
  }

  return {localByName,externalSymbolBySource,moduleAliasBySource};
}

function annotationCandidates(annotation=''){
  return String(annotation||'')
    .match(/[A-Za-z_][A-Za-z0-9_.]*/g) || [];
}

const NON_IDENTITY_TYPE_NAMES=new Set([
  'Any','Optional','Union','Literal','Annotated','Type','Generic','Protocol',
  'Mapping','MutableMapping','Sequence','MutableSequence','Iterable','Iterator',
  'Collection','Container','Set','MutableSet','Tuple','List','Dict','FrozenSet',
  'Deque','DefaultDict','Counter','ChainMap',
  'dict','list','tuple','set','frozenset','str','int','float','bool','bytes',
  'bytearray','complex','object','type','range','memoryview'
]);

const SCALAR_TYPE_NAMES=new Set([
  'str','int','float','bool','bytes','bytearray','complex',
  'date','datetime','time','timedelta',
  'datetime64','timedelta64','Timestamp','Timedelta'
]);

const SCALAR_ANNOTATION_WRAPPERS=new Set([
  'Optional','Union','Annotated','Literal','None','NoneType'
]);

function scalarAnnotation(annotation=''){
  const tokens=annotationCandidates(annotation).map(token=>token.split('.').at(-1)).filter(Boolean);
  if(!tokens.length)return false;

  const containerNames=new Set([
    'Mapping','MutableMapping','Sequence','MutableSequence','Iterable','Iterator',
    'Collection','Container','Set','MutableSet','Tuple','List','Dict','FrozenSet',
    'Deque','DefaultDict','Counter','ChainMap','dict','list','tuple','set','frozenset',
    'ndarray','Array','DataArray'
  ]);
  if(tokens.some(token=>containerNames.has(token)))return false;

  const substantive=tokens.filter(token=>!SCALAR_ANNOTATION_WRAPPERS.has(token));
  return substantive.length>0&&substantive.every(token=>SCALAR_TYPE_NAMES.has(token));
}

function scalarClassId(classId=''){
  const id=String(classId||'');
  return [
    'datetime.date','datetime.datetime','datetime.time','datetime.timedelta',
    'numpy.datetime64','numpy.timedelta64','pandas.Timestamp','pandas.Timedelta'
  ].some(name=>id.endsWith(name));
}

function scalarEntityEvidence(observations,classId=''){
  if(scalarClassId(classId))return true;
  if(inferredKind(observations)==='primitive')return true;

  const annotations=observations.map(item=>String(item?.annotation||'').trim()).filter(Boolean);
  if(annotations.length&&annotations.every(scalarAnnotation))return true;

  const constructors=observations.flatMap(item=>
    arr(item?.origins)
      .filter(origin=>origin?.kind==='constructed'&&origin?.name)
      .map(origin=>String(origin.name).trim())
  );
  if(constructors.length&&constructors.every(name=>SCALAR_TYPE_NAMES.has(leaf(name))))return true;

  return false;
}

function isNonIdentityType(token){
  const raw=String(token||'').trim();
  if(!raw)return true;
  const normalized=raw.replace(/^builtins\./,'');
  const leafName=normalized.split('.').at(-1)||'';
  if(NON_IDENTITY_TYPE_NAMES.has(leafName))return true;
  if(normalized.startsWith('typing.'))return true;
  if(normalized.startsWith('typing_extensions.'))return true;
  if(normalized.startsWith('collections.abc.'))return true;
  if(normalized.startsWith('builtins.'))return true;
  return false;
}

function classScope(classId=''){
  const id=String(classId||'');
  if(id.startsWith('class:'))return 'project';
  if(id.startsWith('external-class:')||id.startsWith('qualified-class:'))return 'external';
  return '';
}

function resolveClassToken(token,catalog,sourcePath=''){
  const raw=String(token||'').trim();
  if(!raw||isNonIdentityType(raw))return '';

  const source=String(sourcePath||'');
  const parts=raw.split('.').filter(Boolean);
  const leafName=parts.at(-1)||'';

  const locals=catalog.localByName.get(leafName)||[];
  const sameFile=locals.filter(item=>item.sourcePath===source);
  if(sameFile.length===1)return sameFile[0].id;
  if(locals.length===1)return locals[0].id;

  if(parts.length===1){
    // A bare imported module such as "typing", "pandas" or "np" is never
    // class identity. Only a concrete symbol imported from a module may be.
    if(catalog.moduleAliasBySource.has(`${source}::${raw}`))return '';

    const qualified=catalog.externalSymbolBySource.get(`${source}::${raw}`)||'';
    if(qualified&&!isNonIdentityType(qualified)){
      return `external-class:${qualified}`;
    }
    return '';
  }

  const rootAlias=parts[0];
  const moduleName=catalog.moduleAliasBySource.get(`${source}::${rootAlias}`)||'';
  if(moduleName){
    const canonical=[moduleName,...parts.slice(1)].join('.');
    if(!isNonIdentityType(canonical)){
      return `external-class:${canonical}`;
    }
    return '';
  }

  if(!isNonIdentityType(raw)){
    return `qualified-class:${raw}`;
  }
  return '';
}

function resolvedClassId(observation,catalog){
  const sourcePath=String(observation?.sourcePath||'');

  for(const origin of arr(observation?.origins)){
    if(origin?.kind!=='constructed'||!origin?.name)continue;
    const resolved=resolveClassToken(origin.name,catalog,sourcePath);
    if(resolved)return resolved;
  }

  for(const token of annotationCandidates(observation?.annotation)){
    const resolved=resolveClassToken(token,catalog,sourcePath);
    if(resolved)return resolved;
  }

  return '';
}

function displayName(observations,classId){
  if(classId){
    const marker=String(classId).split('#').at(-1)?.split('@')[0]||'';
    if(marker)return marker;
    const q=String(classId).split(':').at(-1)||'';
    if(q)return q.split('.').at(-1)||q;
  }
  const {annotations,constructors}=canonicalTypeEvidence(observations);
  if(constructors.length===1)return leaf(constructors[0]);
  if(annotations.length===1)return leaf(annotations[0]);
  const aliases=uniq(observations.map(item=>String(item?.variable||'')).filter(Boolean))
    .sort((a,b)=>a.length-b.length||a.localeCompare(b));
  return aliases[0]||inferredKind(observations)||'entity';
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
    const detailKey=event?.detail&&typeof event.detail==='object'
      ? JSON.stringify(event.detail)
      : String(event?.detail||'');
    const key=`${relationship}:${line}:${Number(event?.endLine||line)}:${detailKey}`;
    if(seen.has(key))continue;
    seen.add(key);
    out.push({...event,relationship});
  }
  return out;
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

function unionAliases(uf,functionIds,observationByKey){
  const allowed=new Set(functionIds.map(String));
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
    uf.union(obsKey(callerId,variable),obsKey(targetId,params[index].variable));
  });

  for(const kw of arr(transfer?.keywordArgs)){
    if(!kw?.name||!kw?.variable)continue;
    const param=params.find(item=>String(item?.variable||'')===String(kw.name));
    if(!param)continue;
    uf.union(obsKey(callerId,kw.variable),obsKey(targetId,param.variable));
  }

  const returned=returnedObservations(targetId,observationByKey);
  for(const resultVariable of arr(transfer?.resultVariables)){
    for(const returnedObs of returned){
      uf.union(obsKey(callerId,resultVariable),obsKey(targetId,returnedObs.variable));
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

function observationMap(){
  return new Map();
}

function addObservations(target,observations){
  for(const obs of observations){
    target.set(obsKey(obs.functionId,obs.variable),obs);
  }
}

function qualifiesAcrossFunctions(observations){
  return new Set(observations.map(obs=>String(obs?.functionId||''))).size>1;
}

function materializeEntity({
  id,
  observations,
  identityKind,
  classId='',
  symbolById,
  entityLinks
}){
  const functionIds=uniq(observations.map(obs=>obs?.functionId));
  if(functionIds.length<2)return null;
  if(scalarEntityEvidence(observations,classId))return null;

  const aliases=uniq(observations.map(obs=>obs?.variable));
  const members=uniq(observations.flatMap(obs=>arr(obs?.members)));
  const methods=uniq(observations.flatMap(obs=>arr(obs?.methods)));
  const keys=uniq(observations.flatMap(obs=>arr(obs?.keys)));
  const origins=uniq(observations.flatMap(originNames));
  const {annotations,constructors}=canonicalTypeEvidence(observations);
  const accessSignatures=[];
  const seenAccessSignatures=new Set();

  let operationCount=0;
  const seenLinks=new Set();

  for(const observation of observations){
    const symbol=symbolById.get(observation.functionId);
    for(const event of canonicalEvents(observation)){
      const region=innermostRegion(symbol,Number(event.line||0));
      const sourceId=region?.id||observation.functionId;
      const sourceType=region?'function-region':'function';
      const relationship=event.relationship;
      const detail=event?.detail&&typeof event.detail==='object' ? event.detail : {};
      if(detail.access||detail.name||detail.valueKind||detail.afterRead){
        const signature={
          functionId:observation.functionId,
          sourcePath:observation.sourcePath||symbol?.sourcePath||'',
          line:Number(event.line||0),
          relationship,
          access:String(detail.access||''),
          name:String(detail.name||''),
          valueKind:String(detail.valueKind||''),
          afterRead:String(detail.afterRead||'')
        };
        const signatureKey=JSON.stringify(signature);
        if(!seenAccessSignatures.has(signatureKey)){
          seenAccessSignatures.add(signatureKey);
          accessSignatures.push(signature);
        }
      }
      const dedupe=`${sourceId}|${relationship}|${Number(event.line||0)}|${id}`;
      if(seenLinks.has(dedupe))continue;
      seenLinks.add(dedupe);
      operationCount+=1;
      entityLinks.push({
        sourceId,
        sourceType,
        relationship,
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

  const functionCount=functionIds.length;
  const coreScore=(functionCount*3)+Math.min(operationCount,30);

  return {
    id,
    type:'entity',
    details:{
      name:displayName(observations,classId),
      kind:inferredKind(observations),
      identityKind,
      classId,
      classScope:classScope(classId),
      aliases,
      annotations,
      constructors,
      origins,
      members,
      methods,
      keys,
      accessSignatures,
      functionCount,
      operationCount,
      coreScore
    },
    links:[]
  };
}

export function buildPythonDataStructureGraph({
  symbols=[],
  observations=[],
  transfers=[],
  flowSlices=[],
  codeFacts=[],
  externalSymbols=[]
}={}){
  const symbolById=new Map(arr(symbols).map(symbol=>[symbol?.id,symbol]));
  const observationByKey=new Map();

  for(const observation of arr(observations)){
    if(!observation?.functionId||!observation?.variable)continue;
    observationByKey.set(obsKey(observation.functionId,observation.variable),observation);
  }

  const catalog=classCatalog(codeFacts,externalSymbols);
  const classIdByBinding=new Map(
    [...observationByKey.entries()].map(([key,obs])=>[key,resolvedClassId(obs,catalog)])
  );
  const transferEdges=transfersByResolvedEdge(transfers,symbolById);

  // Qualified class-backed entities are accumulated globally by resolved class.
  // A class qualifies only when at least two functions in one compact flow
  // observe that class. Continuity across every intermediate call is not
  // required because the class definition supplies stable identity.
  const qualifiedClassObservations=new Map();

  // Anonymous entities require continuous argument/parameter, return/receiver
  // or alias lineage across more than one function in one compact flow.
  const anonymousCandidates=new Map();

  for(const flow of arr(flowSlices)){
    const functionIds=arr(flow?.symbolIds).map(String).filter(Boolean);
    if(functionIds.length<2)continue;
    const functionSet=new Set(functionIds);

    const flowEntries=[...observationByKey.entries()]
      .filter(([,obs])=>functionSet.has(String(obs?.functionId||'')));
    if(!flowEntries.length)continue;

    // Class-backed qualification can be disconnected inside the flow.
    const classGroups=new Map();
    for(const [key,obs] of flowEntries){
      const classId=classIdByBinding.get(key)||'';
      if(!classId)continue;
      if(!classGroups.has(classId))classGroups.set(classId,[]);
      classGroups.get(classId).push(obs);
    }
    for(const [classId,group] of classGroups.entries()){
      if(!qualifiesAcrossFunctions(group))continue;
      if(!qualifiedClassObservations.has(classId))qualifiedClassObservations.set(classId,observationMap());
      addObservations(qualifiedClassObservations.get(classId),group);
    }

    // Continuous lineage for anonymous structures and untyped parameters.
    const flowKeys=flowEntries.map(([key])=>key);
    const uf=new UnionFind(flowKeys);
    unionAliases(uf,functionIds,observationByKey);

    for(let i=0;i<functionIds.length-1;i+=1){
      const from=functionIds[i];
      const to=functionIds[i+1];
      const edge=`${from}→${to}`;
      for(const transfer of transferEdges.get(edge)||[]){
        unionTransfer(uf,transfer,to,observationByKey);
      }
    }

    const components=componentMap(uf,flowKeys,observationByKey);
    for(const component of components.values()){
      if(!qualifiesAcrossFunctions(component))continue;

      const classIds=uniq(component.map(obs=>classIdByBinding.get(obsKey(obs.functionId,obs.variable))||''));
      if(classIds.length===1){
        const classId=classIds[0];
        if(!qualifiedClassObservations.has(classId))qualifiedClassObservations.set(classId,observationMap());
        addObservations(qualifiedClassObservations.get(classId),component);
        continue;
      }

      // If more than one conflicting resolved class appears in the same
      // component, do not collapse them into one anonymous entity.
      if(classIds.length>1)continue;

      const bindings=component
        .map(obs=>obsKey(obs.functionId,obs.variable))
        .sort();
      const candidateId=stableId('entity-trace',`${String(flow?.id||'')}|${bindings.join('|')}`);
      anonymousCandidates.set(candidateId,component);
    }
  }

  const entityLinks=[];
  const entityNodes=[];

  for(const [classId,obsMap] of qualifiedClassObservations.entries()){
    const observationsForEntity=[...obsMap.values()];
    if(!qualifiesAcrossFunctions(observationsForEntity))continue;
    const id=stableId('entity-class',classId);
    const node=materializeEntity({
      id,
      observations:observationsForEntity,
      identityKind:'class',
      classId,
      symbolById,
      entityLinks
    });
    if(node){
      entityNodes.push(node);
    }
  }

  for(const [id,component] of anonymousCandidates.entries()){
    const node=materializeEntity({
      id,
      observations:component,
      identityKind:'continuous',
      symbolById,
      entityLinks
    });
    if(node){
      entityNodes.push(node);
    }
  }

  entityNodes.sort((a,b)=>
    Number(b.details?.coreScore||0)-Number(a.details?.coreScore||0)||
    String(a.details?.name||a.id).localeCompare(String(b.details?.name||b.id))
  );

  return {nodes:entityNodes,entityLinks};
}
