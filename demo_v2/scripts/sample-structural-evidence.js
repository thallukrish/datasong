import fs from 'node:fs';

function parseCsv(text='') {
  const records=[];
  let row=[],cell='',quoted=false;
  const pushCell=()=>{row.push(cell);cell='';};
  const pushRow=()=>{pushCell();if(row.some(v=>v!==''))records.push(row);row=[];};

  for(let i=0;i<String(text).length;i+=1){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i+=1;}
      else if(ch==='"')quoted=false;
      else cell+=ch;
      continue;
    }
    if(ch==='"')quoted=true;
    else if(ch===',')pushCell();
    else if(ch==='\n')pushRow();
    else if(ch!=='\r')cell+=ch;
  }
  if(cell.length||row.length)pushRow();
  if(!records.length)return[];

  const headers=records.shift();
  return records.map(values=>{
    const out={};
    headers.forEach((header,index)=>{out[header]=values[index]??'';});
    out.row=Number(out.row||0);
    return out;
  });
}

function arr(value){
  try{
    const parsed=JSON.parse(String(value||'[]'));
    return Array.isArray(parsed)?parsed.map(String):[];
  }catch{return[];}
}

function details(value){
  try{
    const parsed=JSON.parse(String(value||'{}'));
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
  }catch{return{};}
}

const csvPath=process.argv[2];
const sampleCount=Math.max(1,Number(process.argv[3]||20));

if(!csvPath){
  console.error('Usage: node scripts/sample-structural-evidence.js <python.csv> [sample-count]');
  process.exit(1);
}

const rows=parseCsv(fs.readFileSync(csvPath,'utf8'));
const byRow=new Map(rows.map(row=>[String(row.row),row]));

const edgesFrom=(row)=>{
  const links=arr(row.links);
  const relationships=arr(row.relationships);
  const out=[];
  for(let i=0;i<Math.min(links.length,relationships.length);i+=1){
    const target=byRow.get(links[i]);
    out.push({
      relationship:relationships[i],
      targetRow:Number(links[i]||0),
      targetType:target?.type||'',
      targetName:target?.name||''
    });
  }
  return out;
};

const incoming=new Map();
for(const row of rows){
  for(const edge of edgesFrom(row)){
    const key=String(edge.targetRow);
    if(!incoming.has(key))incoming.set(key,[]);
    incoming.get(key).push({
      sourceRow:row.row,
      sourceType:row.type,
      sourceName:row.name,
      relationship:edge.relationship
    });
  }
}

const functionRowsByFile=new Map();
for(const row of rows.filter(row=>row.type==='function')){
  if(!functionRowsByFile.has(row.file))functionRowsByFile.set(row.file,[]);
  const [startText,endText]=String(row.line_range||'').split('-');
  functionRowsByFile.get(row.file).push({
    row:Number(row.row),
    start:Number(startText||0),
    end:Number(endText||startText||0)
  });
}
for(const values of functionRowsByFile.values()){
  values.sort((a,b)=>(a.end-a.start)-(b.end-b.start)||b.start-a.start);
}

const functionRowForLocation=(file,line)=>{
  const numericLine=Number(line||0);
  if(!numericLine)return 0;
  const enclosing=(functionRowsByFile.get(String(file||''))||[])
    .find(fn=>fn.start<=numericLine&&numericLine<=fn.end);
  return Number(enclosing?.row||0);
};

const functionRowForSource=(sourceRow)=>{
  const source=byRow.get(String(sourceRow));
  if(!source)return 0;
  if(source.type==='function')return source.row;

  const parent=edgesFrom(source).find(edge=>
    edge.relationship==='contained-by'&&edge.targetType==='function'
  );
  if(parent?.targetRow)return Number(parent.targetRow);

  const [startText]=String(source.line_range||'').split('-');
  return functionRowForLocation(source.file,Number(startText||0));
};

const workflows=rows
  .filter(row=>row.type==='workflow')
  .map(row=>{
    const d=details(row.details);
    const functions=edgesFrom(row)
      .filter(edge=>edge.relationship==='contains'&&edge.targetType==='function')
      .map((edge,index)=>({
        position:index+1,
        row:edge.targetRow,
        name:edge.targetName,
        file:byRow.get(String(edge.targetRow))?.file||'',
        line_range:byRow.get(String(edge.targetRow))?.line_range||''
      }));
    return {
      row:row.row,
      name:row.name,
      structuralId:d.structuralId||'',
      functionCount:functions.length,
      functions
    };
  });

const entities=rows
  .filter(row=>row.type==='entity')
  .map(row=>{
    const d=details(row.details);
    const uses=(incoming.get(String(row.row))||[])
      .filter(edge=>['create','read','update','delete'].includes(edge.relationship))
      .map(edge=>{
        const source=byRow.get(String(edge.sourceRow));
        return {
          operation:edge.relationship,
          sourceRow:edge.sourceRow,
          sourceType:edge.sourceType,
          sourceName:edge.sourceName,
          functionRow:functionRowForSource(edge.sourceRow),
          file:source?.file||'',
          line_range:source?.line_range||''
        };
      })
      .filter(use=>use.functionRow);

    return {
      row:row.row,
      name:row.name,
      structuralId:d.structuralId||'',
      kind:d.kind||'',
      identityKind:d.identityKind||'',
      classId:d.classId||'',
      classScope:d.classScope||'',
      functionCount:Number(d.functionCount||0),
      keys:Array.isArray(d.keys)?d.keys:[],
      members:Array.isArray(d.members)?d.members:[],
      methods:Array.isArray(d.methods)?d.methods:[],
      elementKinds:Array.isArray(d.elementKinds)?d.elementKinds:[],
      elementKeys:Array.isArray(d.elementKeys)?d.elementKeys:[],
      elementConstructors:Array.isArray(d.elementConstructors)?d.elementConstructors:[],
      accessSignatures:Array.isArray(d.accessSignatures)?d.accessSignatures:[],
      uses
    };
  });

const entityByRow=new Map(entities.map(entity=>[entity.row,entity]));
const entityRowsByFunction=new Map();
for(const entity of entities){
  for(const use of entity.uses){
    if(!entityRowsByFunction.has(use.functionRow))entityRowsByFunction.set(use.functionRow,new Set());
    entityRowsByFunction.get(use.functionRow).add(entity.row);
  }
}

const GENERIC_ARRAY_MEMBERS=new Set(['dtype','shape','ndim','size','itemsize','nbytes','T']);
const GENERIC_SHAPE_MEMBERS=new Set([...GENERIC_ARRAY_MEMBERS,'values','variables']);
const GENERIC_AFTER_READ=new Set(['assign','compare','return','subscript','expr','if','for','while']);
const GENERIC_WRITE_VALUE_KINDS=new Set(['alias','member','subscript']);

const meaningfulMembers=(entity)=>entity.members.filter(
  member=>!GENERIC_SHAPE_MEMBERS.has(String(member))
);
const meaningfulAfterReadValues=(values)=>values.filter(value=>{
  const text=String(value||'');
  if(!text||GENERIC_AFTER_READ.has(text))return false;
  return text.startsWith('call:')||text.startsWith('member:');
});
const meaningfulWriteKinds=(values)=>values.filter(value=>{
  const text=String(value||'');
  if(!text||GENERIC_WRITE_VALUE_KINDS.has(text))return false;
  return text.startsWith('call:')||
    text==='mapping'||
    text.startsWith('sequence:')||
    text==='set'||
    text.startsWith('binop:')||
    text.startsWith('augassign:');
});

const isContinuousEntity=(entity)=>
  entity.identityKind==='continuous'&&!entity.classId&&!entity.classScope&&entity.kind!=='primitive';

const isStructuredElementCollection=(entity)=>
  entity.elementKeys.length>0||
  entity.elementConstructors.length>0||
  entity.elementKinds.some(kind=>['mapping','object'].includes(String(kind)));

const isShapeEntity=(entity)=>{
  if(!isContinuousEntity(entity))return false;
  if(entity.kind==='mapping')return true;
  if(isStructuredElementCollection(entity))return true;
  if(entity.kind==='object')return entity.keys.length>0||meaningfulMembers(entity).length>0;
  return false;
};

const isValueCollectionEntity=(entity)=>{
  if(!isContinuousEntity(entity)||isShapeEntity(entity))return false;
  return ['array-like','sequence','set'].includes(entity.kind);
};

const summarizeSignatures=(signatures)=>{
  const keys=[...new Set(signatures
    .filter(signature=>signature?.access==='key'&&signature?.name)
    .map(signature=>String(signature.name)))].sort();
  const members=[...new Set(signatures
    .filter(signature=>signature?.access==='member'&&signature?.name)
    .map(signature=>String(signature.name)))].sort();
  const writeValueKinds=[...new Set(signatures
    .filter(signature=>['update','create'].includes(String(signature?.relationship||''))&&signature?.valueKind)
    .map(signature=>String(signature.valueKind)))].sort();
  const afterRead=[...new Set(signatures
    .filter(signature=>signature?.relationship==='read'&&signature?.afterRead)
    .map(signature=>String(signature.afterRead)))].sort();
  return {keys,members,writeValueKinds,afterRead};
};

const setIntersection=(left,right)=>{
  const rightSet=new Set(right);
  return [...new Set(left)].filter(value=>rightSet.has(value)).sort();
};

const flowOccurrences=[];
const qualifiedFlows=[];

for(const flow of workflows){
  const positionByFunctionRow=new Map(
    flow.functions.map(fn=>[Number(fn.row),Number(fn.position)])
  );
  const candidateEntityRows=new Set(
    flow.functions.flatMap(fn=>[...(entityRowsByFunction.get(Number(fn.row))||[])])
  );

  const qualifying=[];
  for(const entityRow of candidateEntityRows){
    const entity=entityByRow.get(entityRow);
    if(!entity||(!isShapeEntity(entity)&&!isValueCollectionEntity(entity)))continue;

    const touches=entity.uses
      .map(use=>{
        const position=positionByFunctionRow.get(use.functionRow);
        if(!position)return null;
        const fn=flow.functions[position-1];
        return {
          position,
          functionRow:use.functionRow,
          functionName:fn?.name||'',
          operation:use.operation,
          sourceType:use.sourceType,
          sourceName:use.sourceName,
          file:use.file,
          line_range:use.line_range
        };
      })
      .filter(Boolean);

    const positions=[...new Set(touches.map(touch=>touch.position))].sort((a,b)=>a-b);
    if(positions.length<2)continue;

    const operations={create:0,read:0,update:0,delete:0};
    touches.forEach(touch=>{
      if(Object.hasOwn(operations,touch.operation))operations[touch.operation]+=1;
    });

    const occurrence={
      flowRow:flow.row,
      flowName:flow.name,
      flowFunctionCount:flow.functionCount,
      entityRow:entity.row,
      entityName:entity.name,
      kind:entity.kind,
      category:isShapeEntity(entity)?'structured-shape':'value-collection-lineage',
      spanLength:positions.at(-1)-positions[0]+1,
      touchedFunctionCount:positions.length,
      positions,
      operations,
      touches
    };
    qualifying.push(occurrence);
    flowOccurrences.push(occurrence);
  }

  if(qualifying.length){
    qualifiedFlows.push({
      row:flow.row,
      name:flow.name,
      functionCount:flow.functionCount,
      qualifyingEntityCount:new Set(qualifying.map(item=>item.entityRow)).size,
      structuredShapeCount:new Set(
        qualifying.filter(item=>item.category==='structured-shape').map(item=>item.entityRow)
      ).size,
      valueCollectionCount:new Set(
        qualifying.filter(item=>item.category==='value-collection-lineage').map(item=>item.entityRow)
      ).size,
      functions:flow.functions
    });
  }
}

const survivingFlowRows=new Set(qualifiedFlows.map(flow=>flow.row));
const survivingFunctionRows=new Set(
  qualifiedFlows.flatMap(flow=>flow.functions.map(fn=>Number(fn.row)))
);

const entityFingerprintByRow=new Map();
for(const entity of entities.filter(isShapeEntity)){
  const occurrences=flowOccurrences.filter(item=>
    item.entityRow===entity.row&&item.category==='structured-shape'
  );
  if(!occurrences.length)continue;

  const relevantFunctionRows=new Set(
    occurrences.flatMap(item=>item.touches.map(touch=>touch.functionRow))
  );
  const signatures=entity.accessSignatures.filter(signature=>{
    const functionRow=functionRowForLocation(signature?.sourcePath,signature?.line);
    return functionRow&&relevantFunctionRows.has(functionRow);
  });
  const summary=summarizeSignatures(signatures);

  entityFingerprintByRow.set(entity.row,{
    entityRow:entity.row,
    entityName:entity.name,
    kind:entity.kind,
    ...summary,
    elementKinds:entity.elementKinds,
    elementKeys:entity.elementKeys,
    elementConstructors:entity.elementConstructors,
    functionRows:[...relevantFunctionRows].sort((a,b)=>a-b),
    flowRows:[...new Set(occurrences.map(item=>item.flowRow))].sort((a,b)=>a-b)
  });
}

const familyParent=new Map([...entityFingerprintByRow.keys()].map(row=>[row,row]));
const familyFind=(row)=>{
  const parent=familyParent.get(row);
  if(parent===row)return row;
  const root=familyFind(parent);
  familyParent.set(row,root);
  return root;
};
const familyUnion=(a,b)=>{
  const ra=familyFind(a),rb=familyFind(b);
  if(ra===rb)return;
  familyParent.set(Math.max(ra,rb),Math.min(ra,rb));
};

const fingerprintRows=[...entityFingerprintByRow.values()];
for(let i=0;i<fingerprintRows.length;i+=1){
  for(let j=i+1;j<fingerprintRows.length;j+=1){
    const left=fingerprintRows[i],right=fingerprintRows[j];
    if(left.kind&&right.kind&&left.kind!==right.kind)continue;

    const commonKeys=setIntersection(left.keys,right.keys);
    const commonMembers=setIntersection(
      left.members.filter(member=>!GENERIC_SHAPE_MEMBERS.has(String(member))),
      right.members.filter(member=>!GENERIC_SHAPE_MEMBERS.has(String(member)))
    );
    const commonWriteValueKinds=meaningfulWriteKinds(
      setIntersection(left.writeValueKinds,right.writeValueKinds)
    );
    const commonAfterRead=meaningfulAfterReadValues(
      setIntersection(left.afterRead,right.afterRead)
    );
    const commonElementKinds=setIntersection(left.elementKinds,right.elementKinds);
    const commonElementKeys=setIntersection(left.elementKeys,right.elementKeys);
    const commonElementConstructors=setIntersection(
      left.elementConstructors,right.elementConstructors
    );

    const keyIdentity=
      commonKeys.length>=2||
      (commonKeys.length>=1&&commonWriteValueKinds.length>=1);
    const memberIdentity=
      commonMembers.length>=2||
      (commonMembers.length>=1&&commonAfterRead.length>=1);
    const structuredElementIdentity=
      commonElementKeys.length>=2||
      (commonElementKeys.length>=1&&commonElementKinds.some(kind=>
        ['mapping','object'].includes(kind)
      ))||
      commonElementConstructors.length>=1;

    if(keyIdentity||memberIdentity||structuredElementIdentity){
      familyUnion(left.entityRow,right.entityRow);
    }
  }
}

const familyMembers=new Map();
for(const fingerprint of fingerprintRows){
  const root=familyFind(fingerprint.entityRow);
  if(!familyMembers.has(root))familyMembers.set(root,[]);
  familyMembers.get(root).push(fingerprint);
}

const intersectAll=(items,key)=>{
  if(!items.length)return[];
  return items.slice(1).reduce(
    (common,item)=>setIntersection(common,item[key]||[]),
    [...new Set(items[0][key]||[])].sort()
  );
};

const shapeFamilies=[...familyMembers.values()]
  .filter(members=>members.length>=2)
  .map(members=>{
    const common={
      keys:intersectAll(members,'keys'),
      members:intersectAll(members,'members')
        .filter(member=>!GENERIC_SHAPE_MEMBERS.has(String(member))),
      writeValueKinds:meaningfulWriteKinds(intersectAll(members,'writeValueKinds')),
      afterRead:meaningfulAfterReadValues(intersectAll(members,'afterRead')),
      elementKinds:intersectAll(members,'elementKinds'),
      elementKeys:intersectAll(members,'elementKeys'),
      elementConstructors:intersectAll(members,'elementConstructors')
    };
    const entityRows=members.map(item=>item.entityRow).sort((a,b)=>a-b);
    const functionRows=[...new Set(members.flatMap(item=>item.functionRows))].sort((a,b)=>a-b);
    const flowRows=[...new Set(members.flatMap(item=>item.flowRows))].sort((a,b)=>a-b);

    const keyIdentity=
      common.keys.length>=2||
      (common.keys.length>=1&&common.writeValueKinds.length>=1);
    const memberIdentity=
      common.members.length>=2||
      (common.members.length>=1&&common.afterRead.length>=1);
    const structuredElementIdentity=
      common.elementKeys.length>=2||
      (common.elementKeys.length>=1&&common.elementKinds.some(kind=>
        ['mapping','object'].includes(kind)
      ))||
      common.elementConstructors.length>=1;

    return {
      kind:members[0]?.kind||'',
      entityCount:entityRows.length,
      flowCount:flowRows.length,
      functionCount:functionRows.length,
      entityRows,
      entityNames:[...new Set(members.map(item=>item.entityName).filter(Boolean))].sort(),
      flowRows,
      functionRows,
      common,
      qualifies:functionRows.length>=2&&(keyIdentity||memberIdentity||structuredElementIdentity)
    };
  })
  .filter(family=>family.qualifies)
  .map(({qualifies,...family})=>family)
  .sort((a,b)=>
    b.functionCount-a.functionCount||
    b.flowCount-a.flowCount||
    b.entityCount-a.entityCount||
    a.entityRows[0]-b.entityRows[0]
  );

const valueOccurrences=flowOccurrences.filter(item=>
  item.category==='value-collection-lineage'&&survivingFlowRows.has(item.flowRow)
);
const valueByEntity=new Map();
for(const occurrence of valueOccurrences){
  if(!valueByEntity.has(occurrence.entityRow))valueByEntity.set(occurrence.entityRow,[]);
  valueByEntity.get(occurrence.entityRow).push(occurrence);
}

const arrayLineages=[...valueByEntity.entries()]
  .map(([entityRow,occurrences])=>{
    const entity=entityByRow.get(entityRow);
    const functionRows=[...new Set(
      occurrences.flatMap(item=>item.touches.map(touch=>touch.functionRow))
    )].sort((a,b)=>a-b);
    const ranked=[...occurrences].sort((a,b)=>
      b.touchedFunctionCount-a.touchedFunctionCount||
      b.spanLength-a.spanLength||
      (b.operations.update+b.operations.read)-(a.operations.update+a.operations.read)
    );
    const representative=ranked[0];

    return {
      entityRow,
      entityName:entity?.name||representative.entityName,
      kind:entity?.kind||representative.kind,
      flowCount:new Set(occurrences.map(item=>item.flowRow)).size,
      functionCount:functionRows.length,
      maxTouchedFunctionCount:Math.max(...occurrences.map(item=>item.touchedFunctionCount)),
      maxSpanLength:Math.max(...occurrences.map(item=>item.spanLength)),
      operations:occurrences.reduce((sum,item)=>({
        create:sum.create+item.operations.create,
        read:sum.read+item.operations.read,
        update:sum.update+item.operations.update,
        delete:sum.delete+item.operations.delete
      }),{create:0,read:0,update:0,delete:0}),
      genericMembers:entity?.members?.filter(member=>GENERIC_ARRAY_MEMBERS.has(String(member)))||[],
      representativeFlow:{
        flowRow:representative.flowRow,
        flowName:representative.flowName,
        functionCount:representative.flowFunctionCount,
        positions:representative.positions,
        touches:representative.touches
      }
    };
  })
  .sort((a,b)=>
    b.functionCount-a.functionCount||
    b.flowCount-a.flowCount||
    b.maxTouchedFunctionCount-a.maxTouchedFunctionCount||
    b.maxSpanLength-a.maxSpanLength||
    a.entityRow-b.entityRow
  );

const coreEntityCandidates=[
  ...shapeFamilies.map(family=>({
    category:'structured-shape',
    rankEvidence:{
      functionCount:family.functionCount,
      flowCount:family.flowCount,
      entityCount:family.entityCount
    },
    candidate:family
  })),
  ...arrayLineages.map(lineage=>({
    category:'value-collection-lineage',
    rankEvidence:{
      functionCount:lineage.functionCount,
      flowCount:lineage.flowCount,
      touchedFunctionCount:lineage.maxTouchedFunctionCount,
      spanLength:lineage.maxSpanLength
    },
    candidate:lineage
  }))
].sort((a,b)=>
  Number(b.rankEvidence.functionCount||0)-Number(a.rankEvidence.functionCount||0)||
  Number(b.rankEvidence.flowCount||0)-Number(a.rankEvidence.flowCount||0)||
  Number(b.rankEvidence.touchedFunctionCount||0)-Number(a.rankEvidence.touchedFunctionCount||0)
);

qualifiedFlows.sort((a,b)=>
  b.qualifyingEntityCount-a.qualifyingEntityCount||
  b.functionCount-a.functionCount||
  a.row-b.row
);

const counts=rows.reduce((acc,row)=>{
  acc[row.type]=(acc[row.type]||0)+1;
  return acc;
},{});

console.log(JSON.stringify({
  csvPath,
  rowCount:rows.length,
  counts,
  flowScreening:{
    totalFlows:workflows.length,
    qualifiedFlows:qualifiedFlows.length,
    droppedFlows:workflows.length-qualifiedFlows.length,
    retainedPercent:workflows.length
      ?Number((qualifiedFlows.length*100/workflows.length).toFixed(2))
      :0,
    distinctFunctionsInQualifiedFlows:survivingFunctionRows.size
  },
  coreStructureReport:{
    shapeFamilies:shapeFamilies.slice(0,sampleCount),
    arrayLineages:arrayLineages.slice(0,sampleCount),
    coreEntityCandidates:coreEntityCandidates.slice(0,sampleCount),
    qualifiedFlowSample:qualifiedFlows.slice(0,sampleCount)
  }
},null,2));
