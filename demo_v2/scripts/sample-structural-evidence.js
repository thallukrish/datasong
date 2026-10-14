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
const sampleCount=Math.max(1,Number(process.argv[3]||5));

if(!csvPath){
  console.error('Usage: node scripts/sample-structural-evidence.js <python.csv> [count]');
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

const allWorkflows=rows
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
      functionCount:Number(d.functionCount||functions.length||0),
      functions
    };
  })
  .sort((a,b)=>b.functionCount-a.functionCount||a.row-b.row);

const workflows=allWorkflows.slice(0,sampleCount);

const allEntities=rows
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
          file:source?.file||'',
          line_range:source?.line_range||''
        };
      });
    return {
      row:row.row,
      name:row.name,
      structuralId:d.structuralId||'',
      kind:d.kind||'',
      identityKind:d.identityKind||'',
      classId:d.classId||'',
      classScope:d.classScope||'',
      functionCount:Number(d.functionCount||0),
      coreScore:Number(d.coreScore||0),
      keys:Array.isArray(d.keys)?d.keys:[],
      members:Array.isArray(d.members)?d.members:[],
      methods:Array.isArray(d.methods)?d.methods:[],
      operationCount:uses.length,
      uses
    };
  })
  .sort((a,b)=>b.operationCount-a.operationCount||a.row-b.row);

const entities=allEntities.slice(0,sampleCount).map(entity=>({
  ...entity,
  keys:entity.keys.slice(0,12),
  members:entity.members.slice(0,12),
  methods:entity.methods.slice(0,12),
  uses:entity.uses.slice(0,12)
}));

const functionRowForSource=(sourceRow)=>{
  const source=byRow.get(String(sourceRow));
  if(!source)return 0;
  if(source.type==='function')return source.row;
  if(source.type==='function-region'){
    const parent=edgesFrom(source).find(edge=>edge.relationship==='contained-by'&&edge.targetType==='function');
    return Number(parent?.targetRow||0);
  }
  return 0;
};

const isStructuredContinuousEntity=(entity)=>{
  if(entity.identityKind!=='continuous'||entity.classId||entity.classScope)return false;
  if(entity.kind==='primitive')return false;
  if(['mapping','array-like','sequence','set'].includes(entity.kind))return true;
  return entity.keys.length>0||entity.members.length>0||entity.methods.length>0;
};

const topFlows=allWorkflows.slice(0,20);

const structuredChains=[];
for(const flow of topFlows){
  const positionByFunctionRow=new Map(flow.functions.map(fn=>[Number(fn.row),Number(fn.position)]));
  for(const entity of allEntities.filter(isStructuredContinuousEntity)){
    const touches=entity.uses
      .map(use=>{
        const functionRow=functionRowForSource(use.sourceRow);
        const position=positionByFunctionRow.get(functionRow);
        if(!position)return null;
        const fn=flow.functions[position-1];
        return {
          position,
          functionRow,
          functionName:fn?.name||'',
          operation:use.operation,
          sourceType:use.sourceType,
          sourceName:use.sourceName,
          file:use.file,
          line_range:use.line_range
        };
      })
      .filter(Boolean);

    if(!touches.length)continue;

    const positions=[...new Set(touches.map(touch=>touch.position))].sort((a,b)=>a-b);
    if(positions.length<2)continue;

    const firstPosition=positions[0];
    const lastPosition=positions.at(-1);
    const spanLength=lastPosition-firstPosition+1;
    const operations={create:0,read:0,update:0,delete:0};
    touches.forEach(touch=>{
      if(Object.hasOwn(operations,touch.operation))operations[touch.operation]+=1;
    });

    structuredChains.push({
      flowRow:flow.row,
      flowName:flow.name,
      flowFunctionCount:flow.functionCount,
      entityRow:entity.row,
      entityName:entity.name,
      kind:entity.kind,
      spanLength,
      touchedFunctionCount:positions.length,
      firstPosition,
      lastPosition,
      positions,
      operations,
      keys:entity.keys.slice(0,12),
      members:entity.members.slice(0,12),
      methods:entity.methods.slice(0,12),
      touches
    });
  }
}

structuredChains.sort((a,b)=>
  b.spanLength-a.spanLength||
  b.touchedFunctionCount-a.touchedFunctionCount||
  (b.operations.update+b.operations.read)-(a.operations.update+a.operations.read)||
  b.flowFunctionCount-a.flowFunctionCount||
  a.entityRow-b.entityRow
);

const coreStructureReport={
  longestFlows:topFlows.map(flow=>({
    row:flow.row,
    name:flow.name,
    functionCount:flow.functionCount,
    functions:flow.functions
  })),
  rankedStructuredChains:structuredChains.slice(0,20)
};

const workflowMembership=new Map();
for(const workflow of rows.filter(row=>row.type==='workflow')){
  const d=details(workflow.details);
  const members=edgesFrom(workflow).filter(edge=>edge.relationship==='contains'&&edge.targetType==='function');
  members.forEach((edge,index)=>{
    const key=String(edge.targetRow);
    if(!workflowMembership.has(key))workflowMembership.set(key,[]);
    workflowMembership.get(key).push({
      workflowRow:workflow.row,
      workflowName:workflow.name||d.callPathId||'',
      position:index+1,
      functionCount:Number(d.functionCount||members.length||0)
    });
  });
}

const mixed=rows
  .filter(row=>row.type==='function')
  .map(row=>{
    const entityOps=edgesFrom(row)
      .filter(edge=>['create','read','update','delete'].includes(edge.relationship)&&edge.targetType==='entity')
      .map(edge=>({
        operation:edge.relationship,
        entityRow:edge.targetRow,
        entityName:edge.targetName
      }));
    const flows=workflowMembership.get(String(row.row))||[];
    return {
      row:row.row,
      name:row.name,
      file:row.file,
      line_range:row.line_range,
      entityOps,
      flows
    };
  })
  .filter(item=>item.entityOps.length&&item.flows.length)
  .sort((a,b)=>(b.entityOps.length+b.flows.length)-(a.entityOps.length+a.flows.length)||a.row-b.row)
  .slice(0,sampleCount);

const entityRows=rows
  .filter(row=>row.type==='entity')
  .map(row=>({row,details:details(row.details)}));

const entityDistribution={
  total:entityRows.length,
  byFunctionCount:{
    two:0,
    three:0,
    fourPlus:0
  },
  byIdentityKind:{},
  byClassScope:{},
  byKind:{}
};

for(const item of entityRows){
  const d=item.details;
  const functionCount=Number(d.functionCount||0);
  if(functionCount===2)entityDistribution.byFunctionCount.two+=1;
  else if(functionCount===3)entityDistribution.byFunctionCount.three+=1;
  else if(functionCount>=4)entityDistribution.byFunctionCount.fourPlus+=1;

  const identityKind=String(d.identityKind||'unknown');
  entityDistribution.byIdentityKind[identityKind]=(entityDistribution.byIdentityKind[identityKind]||0)+1;

  const classScope=String(d.classScope||'none');
  entityDistribution.byClassScope[classScope]=(entityDistribution.byClassScope[classScope]||0)+1;

  const kind=String(d.kind||'unknown');
  entityDistribution.byKind[kind]=(entityDistribution.byKind[kind]||0)+1;
}

const counts=rows.reduce((acc,row)=>{
  acc[row.type]=(acc[row.type]||0)+1;
  return acc;
},{});

console.log(JSON.stringify({
  csvPath,
  rowCount:rows.length,
  counts,
  entityDistribution,
  coreStructureReport,
  samples:{
    workflows,
    entities,
    mixedFunctions:mixed
  }
},null,2));
