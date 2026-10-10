const arr=(value)=>Array.isArray(value)?value:[];

function parseArray(value){
  if(Array.isArray(value))return value.map(String);
  try{
    const parsed=JSON.parse(String(value||'[]'));
    return Array.isArray(parsed)?parsed.map(String):[];
  }catch{return[]}
}

function parseDetails(value){
  if(value&&typeof value==='object'&&!Array.isArray(value))return value;
  try{
    const parsed=JSON.parse(String(value||'{}'));
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
  }catch{return{}}
}

function rangeStart(row){
  return Number(String(row?.line_range||'').split('-')[0]||0);
}

function rangeEnd(row){
  const parts=String(row?.line_range||'').split('-');
  return Number(parts[1]||parts[0]||0);
}

function rowMap(rows=[]){
  return new Map(arr(rows).map(row=>[String(row?.row||''),row]).filter(([id])=>id));
}

function relationshipTargets(row,relationship){
  const links=parseArray(row?.links),rels=parseArray(row?.relationships),out=[];
  for(let i=0;i<Math.min(links.length,rels.length);i+=1){
    if(rels[i]===relationship)out.push(links[i]);
  }
  return out;
}

function structuralRowForState(state,rows=[]){
  if(!state)return null;
  const file=String(state.sourcePath||'');
  const start=Number(state.startLine||0);
  const end=Number(state.endLine||start);
  const wantedType=state.type==='code_symbol'?'function':null;

  const exact=arr(rows).filter(row=>
    String(row?.file||'')===file &&
    rangeStart(row)===start &&
    rangeEnd(row)===end &&
    (!wantedType||String(row?.type||'')===wantedType)
  );
  if(exact.length)return exact[0];

  if(state.type==='code_symbol'){
    return arr(rows).find(row=>
      String(row?.file||'')===file &&
      String(row?.type||'')==='function' &&
      rangeStart(row)===start
    )||null;
  }

  return arr(rows)
    .filter(row=>String(row?.file||'')===file&&rangeStart(row)<=start&&rangeEnd(row)>=end)
    .sort((a,b)=>(rangeEnd(a)-rangeStart(a))-(rangeEnd(b)-rangeStart(b)))[0]||null;
}

function containedRows(root,byId,limit=128){
  if(!root)return[];
  const out=[],queue=[...relationshipTargets(root,'contains')],seen=new Set();
  while(queue.length&&out.length<limit){
    const id=String(queue.shift()||'');
    if(!id||seen.has(id))continue;
    seen.add(id);
    const row=byId.get(id);
    if(!row)continue;
    out.push(row);
    queue.push(...relationshipTargets(row,'contains'));
  }
  return out;
}

function entitySummary(row){
  const details=parseDetails(row?.details);
  const bits=[];
  if(details.kind)bits.push(String(details.kind));
  const keys=arr(details.keys).map(String).filter(Boolean).slice(0,5);
  if(keys.length)bits.push(`keys=${keys.join(',')}`);
  const members=arr(details.members).map(String).filter(Boolean).slice(0,4);
  if(members.length)bits.push(`members=${members.join(',')}`);
  const methods=arr(details.methods).map(String).filter(Boolean).slice(0,4);
  if(methods.length)bits.push(`methods=${methods.join(',')}`);
  return bits.join('; ');
}

function entityEvidence(scopeRows,byId,maxEntities=8){
  const seen=new Set(),out=[];
  for(const source of scopeRows){
    const links=parseArray(source?.links),rels=parseArray(source?.relationships);
    for(let i=0;i<Math.min(links.length,rels.length);i+=1){
      const relationship=rels[i];
      if(!['create','read','update','delete'].includes(relationship))continue;
      const entity=byId.get(links[i]);
      if(!entity||String(entity.type||'')!=='entity')continue;
      const key=`${relationship}|${entity.row}`;
      if(seen.has(key))continue;
      seen.add(key);
      const details=parseDetails(entity.details);
      out.push({
        id:String(details.structuralId||`entity-row:${entity.row}`),
        row:Number(entity.row||0),
        name:String(entity.name||''),
        operation:relationship,
        description:entitySummary(entity),
        details
      });
      if(out.length>=maxEntities)return out;
    }
  }
  return out;
}

function flowEvidence(functionRow,rows=[],maxFlows=5){
  if(!functionRow)return[];
  const functionId=String(functionRow.row||'');
  const out=[];
  for(const row of arr(rows)){
    if(String(row?.type||'')!=='workflow')continue;
    const members=relationshipTargets(row,'contains');
    const position=members.indexOf(functionId);
    if(position<0)continue;
    const details=parseDetails(row.details);
    out.push({
      id:String(details.structuralId||`workflow-row:${row.row}`),
      row:Number(row.row||0),
      name:String(row.name||details.callPathId||''),
      position:position+1,
      functionCount:Number(details.functionCount||members.length||0),
      branchVariantCount:Number(details.branchVariantCount||0),
      alternateEntranceCount:Number(details.alternateEntranceCount||0)
    });
    if(out.length>=maxFlows)break;
  }
  return out;
}

function enclosingFunctionRow(state,rows=[]){
  if(!state)return null;
  if(state.type==='code_symbol')return structuralRowForState(state,rows);
  const file=String(state.sourcePath||''),line=Number(state.startLine||0);
  return arr(rows)
    .filter(row=>String(row?.type||'')==='function'&&String(row?.file||'')===file&&rangeStart(row)<=line&&rangeEnd(row)>=line)
    .sort((a,b)=>(rangeEnd(a)-rangeStart(a))-(rangeEnd(b)-rangeStart(b)))[0]||null;
}

export function structuralLineageForState(state,explorer,{maxEntities=8,maxFlows=5}={}){
  const rows=arr(explorer?.topology?.codeStructureRows);
  if(!rows.length||!state)return{entities:[],flows:[]};

  const byId=rowMap(rows);
  const structuralRow=structuralRowForState(state,rows);
  const functionRow=enclosingFunctionRow(state,rows);
  const scopeRows=structuralRow
    ? [structuralRow,...containedRows(structuralRow,byId)]
    : functionRow
      ? [functionRow,...containedRows(functionRow,byId)]
      : [];

  return {
    entities:entityEvidence(scopeRows,byId,maxEntities),
    flows:flowEvidence(functionRow,rows,maxFlows)
  };
}

export function compactStructuralLineage(lineage={}){
  const entities=arr(lineage.entities).slice(0,6).map(item=>[
    item.operation||'',
    item.name||'',
    item.description||''
  ]);
  const flows=arr(lineage.flows).slice(0,4).map(item=>[
    item.name||'',
    Number(item.position||0),
    Number(item.functionCount||0)
  ]);
  return {entities,flows};
}
