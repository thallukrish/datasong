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
const chainScope=String(process.argv[4]||'all').trim().toLowerCase();
const validChainScopes=new Set(['all','production','tests']);

if(!csvPath){
  console.error('Usage: node scripts/sample-structural-evidence.js <python.csv> [count] [all|production|tests]');
  process.exit(1);
}
if(!validChainScopes.has(chainScope)){
  console.error(`Invalid chain scope "${chainScope}". Use all, production, or tests.`);
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
      accessSignatures:Array.isArray(d.accessSignatures)?d.accessSignatures:[],
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
  const line=Number(startText||0);
  if(!line)return 0;

  return functionRowForLocation(source.file,line);
};

const isStructuredContinuousEntity=(entity)=>{
  if(entity.identityKind!=='continuous'||entity.classId||entity.classScope)return false;
  if(entity.kind==='primitive')return false;
  if(['mapping','array-like','sequence','set'].includes(entity.kind))return true;
  return entity.keys.length>0||entity.members.length>0||entity.methods.length>0;
};

const functionRows=rows.filter(row=>row.type==='function');
const functionGraph=new Map(functionRows.map(row=>[
  Number(row.row),
  edgesFrom(row)
    .filter(edge=>edge.relationship==='calls'&&edge.targetType==='function')
    .map(edge=>Number(edge.targetRow))
    .filter(Boolean)
]));

// Collapse recursive cycles before ranking. This keeps the ranking finite while
// preserving every function that participates in a recursive component.
let tarjanIndex=0;
const stack=[];
const onStack=new Set();
const indexByRow=new Map();
const lowByRow=new Map();
const components=[];

function strongConnect(row){
  indexByRow.set(row,tarjanIndex);
  lowByRow.set(row,tarjanIndex);
  tarjanIndex+=1;
  stack.push(row);
  onStack.add(row);

  for(const target of functionGraph.get(row)||[]){
    if(!indexByRow.has(target)){
      strongConnect(target);
      lowByRow.set(row,Math.min(lowByRow.get(row),lowByRow.get(target)));
    }else if(onStack.has(target)){
      lowByRow.set(row,Math.min(lowByRow.get(row),indexByRow.get(target)));
    }
  }

  if(lowByRow.get(row)!==indexByRow.get(row))return;
  const members=[];
  while(stack.length){
    const member=stack.pop();
    onStack.delete(member);
    members.push(member);
    if(member===row)break;
  }
  components.push(members.sort((a,b)=>a-b));
}

for(const row of functionGraph.keys()){
  if(!indexByRow.has(row))strongConnect(row);
}

const componentByRow=new Map();
components.forEach((members,index)=>members.forEach(row=>componentByRow.set(row,index)));

const componentGraph=new Map(components.map((_,index)=>[index,new Set()]));
const componentIncoming=new Map(components.map((_,index)=>[index,0]));
for(const [source,targets] of functionGraph.entries()){
  const sourceComponent=componentByRow.get(source);
  for(const target of targets){
    const targetComponent=componentByRow.get(target);
    if(sourceComponent===targetComponent)continue;
    const outgoing=componentGraph.get(sourceComponent);
    if(!outgoing.has(targetComponent)){
      outgoing.add(targetComponent);
      componentIncoming.set(targetComponent,(componentIncoming.get(targetComponent)||0)+1);
    }
  }
}

const longestFromMemo=new Map();
function longestFrom(component){
  if(longestFromMemo.has(component))return longestFromMemo.get(component);
  let best=[component];
  for(const target of componentGraph.get(component)||[]){
    const candidate=[component,...longestFrom(target)];
    const candidateLength=candidate.reduce((sum,id)=>sum+components[id].length,0);
    const bestLength=best.reduce((sum,id)=>sum+components[id].length,0);
    if(candidateLength>bestLength)best=candidate;
  }
  longestFromMemo.set(component,best);
  return best;
}

const roots=[...componentGraph.keys()]
  .filter(component=>(componentIncoming.get(component)||0)===0);
const starts=roots.length?roots:[...componentGraph.keys()];

const callChains=starts
  .map(component=>longestFrom(component))
  .map((componentPath,index)=>{
    const chainRows=componentPath.flatMap(component=>components[component]);
    const functions=chainRows.map((row,index)=>({
      position:index+1,
      row,
      name:byRow.get(String(row))?.name||'',
      file:byRow.get(String(row))?.file||'',
      line_range:byRow.get(String(row))?.line_range||''
    }));
    return {
      row:index+1,
      name:`callchain:${functions.map(fn=>fn.name).slice(0,3).join('→')}`,
      functionCount:functions.length,
      functions,
      recursiveComponentCount:componentPath.filter(component=>components[component].length>1).length
    };
  })
  .sort((a,b)=>b.functionCount-a.functionCount||a.name.localeCompare(b.name));

const isTestFunction=(fn)=>{
  const file=String(fn?.file||'').replaceAll('\\','/').toLowerCase();
  return file.includes('/tests/')||file.startsWith('tests/')||
    file.includes('/test/')||file.startsWith('test/')||
    file.startsWith('asv_bench/')||file.includes('/asv_bench/');
};

const chainMatchesScope=(chain)=>{
  if(chainScope==='all')return true;
  const testFlags=chain.functions.map(isTestFunction);
  if(chainScope==='tests')return testFlags.some(Boolean);
  return testFlags.every(flag=>!flag);
};

const scopedCallChains=callChains.filter(chainMatchesScope);
const topFlows=scopedCallChains.slice(0,20);

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

const setIntersection=(left,right)=>{
  const b=new Set(right);
  return [...new Set(left)].filter(value=>b.has(value)).sort();
};

const fingerprintForOccurrence=(occurrence)=>{
  const entity=allEntities.find(item=>item.row===occurrence.entityRow);
  const flow=topFlows.find(item=>item.row===occurrence.flowRow);
  if(!entity||!flow)return null;

  const allowedFunctions=new Set(flow.functions.map(fn=>Number(fn.row)));
  const signatures=entity.accessSignatures.filter(signature=>{
    const functionRow=functionRowForLocation(signature?.sourcePath,signature?.line);
    return functionRow&&allowedFunctions.has(functionRow);
  });

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
  const signatureFunctionRows=[...new Set(signatures
    .map(signature=>functionRowForLocation(signature?.sourcePath,signature?.line))
    .filter(Boolean))].sort((a,b)=>a-b);

  return {
    flowRow:occurrence.flowRow,
    flowName:occurrence.flowName,
    entityRow:occurrence.entityRow,
    entityName:occurrence.entityName,
    kind:occurrence.kind,
    keys,
    members,
    writeValueKinds,
    afterRead,
    signatureFunctionRows
  };
};

const occurrenceFingerprints=structuredChains
  .map(fingerprintForOccurrence)
  .filter(Boolean);

const fingerprintIntersections=[];
for(let i=0;i<occurrenceFingerprints.length;i+=1){
  for(let j=i+1;j<occurrenceFingerprints.length;j+=1){
    const left=occurrenceFingerprints[i];
    const right=occurrenceFingerprints[j];
    if(left.flowRow===right.flowRow)continue;
    if(left.entityRow===right.entityRow)continue;
    if(left.kind&&right.kind&&left.kind!==right.kind)continue;

    const commonKeys=setIntersection(left.keys,right.keys);
    const commonMembers=setIntersection(left.members,right.members);
    const commonWriteValueKinds=setIntersection(left.writeValueKinds,right.writeValueKinds);
    const commonAfterRead=setIntersection(left.afterRead,right.afterRead);

    const score=
      commonKeys.length*4+
      commonMembers.length*4+
      commonWriteValueKinds.length*3+
      commonAfterRead.length*2;

    if(score<=0)continue;
    const sharedFunctionRows=setIntersection(
      left.signatureFunctionRows.map(String),
      right.signatureFunctionRows.map(String)
    ).map(Number);

    fingerprintIntersections.push({
      score,
      kind:left.kind||right.kind,
      independentFunctionEvidence:sharedFunctionRows.length===0,
      sharedFunctionRows,
      left:{
        flowRow:left.flowRow,
        flowName:left.flowName,
        entityRow:left.entityRow,
        entityName:left.entityName
      },
      right:{
        flowRow:right.flowRow,
        flowName:right.flowName,
        entityRow:right.entityRow,
        entityName:right.entityName
      },
      common:{
        keys:commonKeys,
        members:commonMembers,
        writeValueKinds:commonWriteValueKinds,
        afterRead:commonAfterRead
      }
    });
  }
}

fingerprintIntersections.sort((a,b)=>
  b.score-a.score||
  Number(b.independentFunctionEvidence)-Number(a.independentFunctionEvidence)||
  a.left.entityRow-b.left.entityRow||
  a.right.entityRow-b.right.entityRow
);

const coreStructureReport={
  chainScope,
  candidateCallChainCount:scopedCallChains.length,
  longestFlows:topFlows.map(flow=>({
    row:flow.row,
    name:flow.name,
    functionCount:flow.functionCount,
    functions:flow.functions
  })),
  rankedStructuredChains:structuredChains.slice(0,20),
  fingerprintIntersections:fingerprintIntersections.slice(0,20)
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
  chainScope,
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
