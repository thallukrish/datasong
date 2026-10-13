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
      functionCount:Number(d.functionCount||functions.length||0),
      functions
    };
  })
  .sort((a,b)=>b.functionCount-a.functionCount||a.row-b.row)
  .slice(0,sampleCount);

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
      functionCount:Number(d.functionCount||0),
      coreScore:Number(d.coreScore||0),
      keys:Array.isArray(d.keys)?d.keys.slice(0,12):[],
      members:Array.isArray(d.members)?d.members.slice(0,12):[],
      methods:Array.isArray(d.methods)?d.methods.slice(0,12):[],
      operationCount:uses.length,
      uses:uses.slice(0,12)
    };
  })
  .sort((a,b)=>b.operationCount-a.operationCount||a.row-b.row)
  .slice(0,sampleCount);

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

const counts=rows.reduce((acc,row)=>{
  acc[row.type]=(acc[row.type]||0)+1;
  return acc;
},{});

console.log(JSON.stringify({
  csvPath,
  rowCount:rows.length,
  counts,
  samples:{
    workflows,
    entities,
    mixedFunctions:mixed
  }
},null,2));
