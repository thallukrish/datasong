import { executeSteps } from 'pal-executor-lib';

function arr(value){
  return Array.isArray(value)?value:[];
}

export function expandPalRange(range=''){
  const text=String(range||'');
  const match=text.match(/^(\d+)(?:-(\d+))?$/);
  if(!match)return [];
  const start=Number(match[1]);
  const end=Number(match[2]||match[1]);
  if(!Number.isInteger(start)||!Number.isInteger(end)||end<start)return [];
  const out=[];
  for(let i=start;i<=end;i+=1)out.push(i);
  return out;
}

export function palRowsForValue(valuesIndex,column,value){
  const entries=valuesIndex?.[column];
  if(!Array.isArray(entries))return null;
  const wanted=String(value);
  const out=[];
  for(const entry of entries){
    if(!Array.isArray(entry)||entry.length<2)continue;
    if(String(entry[1])!==wanted)continue;
    out.push(...expandPalRange(entry[0]));
  }
  return [...new Set(out)];
}

function palIndexDataset(topology){
  const values={};
  for(const [column,entries] of Object.entries(topology?.palValuesIndex||{})){
    if(!Array.isArray(entries))continue;
    values[column]=new Map(entries.map(entry=>[String(entry?.[0]??''),entry?.[1]]));
  }
  const unique=new Map();
  for(const [column,items] of Object.entries(topology?.palUniqueIndex||{})){
    unique.set(column,new Set(arr(items)));
  }
  const headers=Object.keys(topology?.palValuesIndex||{});
  return {
    dataset_name:'lem_code_structure',
    model:'local',
    llm_key:'local',
    dataset_description:'LeMap structural code rows',
    columnHeaders:headers,
    column_types:'',
    columnInsights:{},
    rowCount:arr(topology?.codeStructureRows).length,
    valuesIndex:values,
    uniqueIndex:unique,
    attributesOriginalMap:Object.fromEntries(headers.map(column=>[column,column]))
  };
}

function palString(value=''){
  return "'" + String(value).replace(/\\/g,'\\\\').replace(/'/g,"\\'") + "'";
}

function palResultRows(result,output='lem_entry_filter'){
  const value=result?.context?.[output]?.value;
  const ranges=Array.isArray(value)?value:[];
  return [...new Set(ranges.flatMap(expandPalRange))];
}

async function exactPalFilterRows({topology,type='*',name=''}) {
  if(!topology?.palValuesIndex||!topology?.palUniqueIndex)return null;
  const output='lem_entry_filter';
  const expression=type==='*'
    ? `data.name == ${palString(name)}`
    : `data.type == ${palString(type)} && data.name == ${palString(name)}`;
  const result=await executeSteps([{
    step:1,
    command:'FILTER',
    input:'data',
    output,
    details:{expression}
  }],{dataset:palIndexDataset(topology)});
  if(result?.error)throw new Error(`PAL FILTER failed: ${result.error}`);
  return palResultRows(result,output);
}

function intersectRows(left=[],right=[]){
  const rightSet=new Set(right);
  return left.filter(row=>rightSet.has(row));
}

export function prefixMatchesFromCanonicalIndexes({
  uniqueIndex,
  valuesIndex,
  type='*',
  value='',
  maxNames=40
}={}){
  const raw=String(value||'').trim();
  if(!raw.endsWith('*'))return [];
  const prefix=raw.slice(0,-1).toLowerCase();
  if(!prefix)return [];

  // PAL's canonical unique index is column -> unique values. Prefixes are
  // discovered from the name column, then restricted to the requested
  // structural type by intersecting valuesIndex row positions.
  const names=arr(uniqueIndex?.name)
    .filter(name=>String(name).toLowerCase().startsWith(prefix));

  if(type==='*')return names.slice(0,maxNames).map(name=>({
    name:String(name),
    rows:palRowsForValue(valuesIndex,'name',name)||[]
  }));

  const typeRows=palRowsForValue(valuesIndex,'type',type)||[];
  if(!typeRows.length)return [];

  const matches=[];
  for(const name of names){
    const nameRows=palRowsForValue(valuesIndex,'name',name)||[];
    const rows=intersectRows(nameRows,typeRows);
    if(!rows.length)continue;
    matches.push({name:String(name),rows});
    if(matches.length>=maxNames)break;
  }
  return matches;
}

export async function resolvePalStructuralLocator({topology,type='*',name='',maxNames=40}={}){
  const raw=String(name||'').trim();
  if(!raw)return [];

  if(raw.endsWith('*')){
    return prefixMatchesFromCanonicalIndexes({
      uniqueIndex:topology?.palUniqueIndex,
      valuesIndex:topology?.palValuesIndex,
      type,
      value:raw,
      maxNames
    });
  }

  const rows=await exactPalFilterRows({topology,type,name:raw});
  return Array.isArray(rows)?[{name:raw,rows}]:[];
}
