import fs from 'node:fs/promises';
import path from 'node:path';
import { executeSteps } from 'pal-executor-lib';
import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';

const CODE_CONSTRUCT_TYPES = [
  'class','function','input_param','import','assignment','call','return','exception',
  'if','for','while','try','except','with','assert','match','case','break','continue',
  'pass','global','nonlocal','delete','await','yield','expression'
];

const ENTRY_SELECT_SYSTEM = `Extract identifiers from the issue that are useful for locating the existing implementation.

Allowed types:
class,function,input_param,import,assignment,call,return,exception,if,for,while,try,except,with,assert,match,case,break,continue,pass,global,nonlocal,delete,await,yield,expression,*

Return only:
{"matches":[{"type":"...","value":"..."}]}

Prefer identifiers that name implementation concepts or controls mentioned by the issue, such as a function name, parameter name, option name, class, or method.
Use * when the construct type is uncertain rather than guessing a wrong type.
A value may end in * when only part of the identifier is known.
Do not return generic library construction calls from the reproduction example unless they directly identify the implementation being investigated.
Do not invent identifiers describing the proposed fix.
Return at most 6 matches.`;

const MAX_PATTERNS = 8;
const MAX_HITS = 80;
const MAX_FILE_BYTES = 750_000;

function isTestPath(sourcePath=''){
  return /(^|\/|\\)(test|tests|spec|specs|__tests__|fixtures?|mocks?)(\/|\\|$)|(?:^|[._-])(test|spec)\.[^.]+$/i.test(String(sourcePath||''));
}

function normalizedPatterns(items=[]){
  const out=[];
  for(const item of arr(items).slice(0,MAX_PATTERNS)){
    const pattern=String(item?.pattern||'').trim();
    if(!pattern||pattern.length>180)continue;
    const kind=String(item?.kind||'regex').toLowerCase();
    if(kind!=='regex')continue;
    const weight=Math.max(1,Math.min(5,Number(item?.weight||1)));
    try{new RegExp(pattern,'i')}catch{continue}
    out.push({pattern,kind:'regex',weight});
  }
  return out;
}

function normalizedLocators(items=[]){
  const out=[];
  const seen=new Set();
  for(const item of arr(items).slice(0,6)){
    const type=String(item?.type||'*').trim().toLowerCase()||'*';
    if(type!=='*'&&!CODE_CONSTRUCT_TYPES.includes(type))continue;
    const name=String(item?.value??item?.name??'').trim();
    if(!name||name.length>180)continue;
    const key=`${type}|${name}`;
    if(seen.has(key))continue;
    seen.add(key);
    out.push({type,name});
  }
  return out;
}

export function normalizeEntrySelectionPlan(parsed={}){
  const requested=String(parsed?.action||parsed?.strategy||'root_entries').toLowerCase();
  const locators=normalizedLocators(parsed?.matches||parsed?.locators||parsed?.searches);
  const patterns=requested==='pattern_search'?normalizedPatterns(parsed?.patterns):[];
  const strategy=locators.length?'structured_search':patterns.length?'pattern_search':'root_entries';
  return {strategy,reason:text(parsed?.reason||'',320),locators,searches:locators,patterns};
}

function parseLineStart(range=''){
  return Number(String(range||'').split('-')[0]||0);
}

function enclosingSymbol(topology,sourcePath,line){
  return arr(topology?.symbols)
    .filter(symbol=>symbol?.sourcePath===sourcePath&&Number(symbol?.startLine||0)<=line&&Number(symbol?.endLine||0)>=line)
    .sort((a,b)=>(Number(a.endLine||0)-Number(a.startLine||0))-(Number(b.endLine||0)-Number(b.startLine||0)))[0]||null;
}

function externalAtLine(topology,sourcePath,line){
  return arr(topology?.externalSymbols).find(boundary=>
    boundary?.sourcePath===sourcePath &&
    Number(boundary?.startLine||0)<=line &&
    Number(boundary?.endLine||boundary?.startLine||0)>=line
  )||null;
}

function rowMap(rows=[]){
  return new Map(arr(rows).map(row=>[String(row?.row||''),row]).filter(([key])=>key));
}

function functionAnchor(row,rowsById){
  let current=row;
  const seen=new Set();
  while(current){
    const id=String(current?.row||'');
    if(id&&seen.has(id))break;
    if(id)seen.add(id);
    if(String(current?.type||'').toLowerCase()==='function')return current;
    const parent=String(current?.parent||'');
    if(!parent)break;
    current=rowsById.get(parent);
  }
  return null;
}

function expandPalRange(range=''){
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

function palRowsForValue(valuesIndex,column,value){
  const entries=valuesIndex?.[column];
  if(!Array.isArray(entries))return null;
  const wanted=String(value);
  const out=[];
  for(const entry of entries){
    if(!Array.isArray(entry)||entry.length<2)continue;
    if(String(entry[1])!==wanted)continue;
    out.push(...expandPalRange(entry[0]));
  }
  return out;
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

function prefixValues(uniqueIndex,type,value){
  const raw=String(value||'').trim();
  if(!raw.endsWith('*'))return [raw];
  const needle=raw.slice(0,-1).toLowerCase();
  const column=type!=='*'&&Array.isArray(uniqueIndex?.[type])?type:'name';
  const values=arr(uniqueIndex?.[column]);
  return values
    .filter(item=>String(item).toLowerCase().startsWith(needle))
    .slice(0,40);
}

function palResultRows(result,output='lem_entry_filter'){
  const value=result?.context?.[output]?.value;
  const ranges=Array.isArray(value)?value:[];
  return [...new Set(ranges.flatMap(expandPalRange))];
}

async function palFilterRows({topology,type='*',name=''}) {
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

export async function scanCodeStructureRowsWithPal({topology,locators=[]}){
  const rows=arr(topology?.codeStructureRows);
  if(!rows.length)return [];
  const specs=normalizedLocators(locators);
  const byId=rowMap(rows);
  const hits=[];
  const seen=new Set();
  const perLocatorLimit=Math.max(6,Math.floor(MAX_HITS/Math.max(1,specs.length)));

  for(const spec of specs){
    let addedForSpec=0;
    const expanded=prefixValues(topology?.palUniqueIndex,spec.type,spec.name);
    for(const resolvedName of expanded){
      const candidateIndexes=await palFilterRows({topology,type:spec.type,name:resolvedName});
      if(!Array.isArray(candidateIndexes))continue;
      for(const index of candidateIndexes){
        const row=rows[index];
        if(!row)continue;
        const rowType=String(row?.type||'').trim().toLowerCase();
        const rowName=String(row?.name||'').trim();
        const anchor=functionAnchor(row,byId);
        const sourcePath=String((anchor||row)?.file||'');
        const line=parseLineStart((anchor||row)?.line_range);
        if(!sourcePath||!line)continue;
        const symbol=enclosingSymbol(topology,sourcePath,line);
        const external=!symbol?externalAtLine(topology,sourcePath,line):null;
        const prefix=String(spec.name).endsWith('*');
        const key=`${spec.type}|${resolvedName}|${sourcePath}|${line}`;
        if(seen.has(key))continue;
        seen.add(key);
        hits.push({
          sourcePath,
          line,
          endLine:Number(String((anchor||row)?.line_range||line).split('-')[1]||line),
          text:`${rowType} ${rowName}`,
          pattern:`${spec.type}:${spec.name}`,
          kind:'structured',
          weight:1,
          structuralScore:(spec.type==='*'?(prefix?600:750):(prefix?850:1000))+(rowType==='function'?50:0),
          matchQuality:{exact:prefix?0:(spec.type==='*'?1:2),prefix:prefix?1:0,contains:0,filters:['pal']},
          symbolId:symbol?.id||'',
          symbolName:symbol?.name||anchor?.name||'',
          externalId:external?.id||'',
          externalName:external?.qualifiedName||external?.name||'',
          test:isTestPath(sourcePath),
          metadata:{...row,resolvedName,requestedName:spec.name,pal:true}
        });
        addedForSpec+=1;
        if(addedForSpec>=perLocatorLimit||hits.length>=MAX_HITS)break;
      }
      if(addedForSpec>=perLocatorLimit||hits.length>=MAX_HITS)break;
    }
    if(hits.length>=MAX_HITS)break;
  }
  return hits;
}

export function scanCodeStructureRows({topology,locators=[]}){
  const rows=arr(topology?.codeStructureRows);
  if(!rows.length)return [];
  const specs=normalizedLocators(locators);
  const byId=rowMap(rows);
  const valuesIndex=topology?.palValuesIndex&&typeof topology.palValuesIndex==='object'
    ? topology.palValuesIndex
    : null;
  const hits=[];
  const seen=new Set();

  for(const spec of specs){
    let candidateIndexes=null;
    if(valuesIndex){
      const nameRows=palRowsForValue(valuesIndex,'name',spec.name);
      if(Array.isArray(nameRows)){
        if(spec.type==='*'){
          candidateIndexes=nameRows;
        }else{
          const typeRows=palRowsForValue(valuesIndex,'type',spec.type);
          if(Array.isArray(typeRows)){
            const typeSet=new Set(typeRows);
            candidateIndexes=nameRows.filter((index)=>typeSet.has(index));
          }
        }
      }
    }

    const candidates=Array.isArray(candidateIndexes)
      ? candidateIndexes.map((index)=>rows[index]).filter(Boolean)
      : rows.filter((row)=>{
          const rowType=String(row?.type||'').trim().toLowerCase();
          const rowName=String(row?.name||'').trim();
          return (spec.type==='*'||rowType===spec.type)&&rowName===spec.name;
        });

    for(const row of candidates){
      const rowType=String(row?.type||'').trim().toLowerCase();
      const rowName=String(row?.name||'').trim();
      const anchor=functionAnchor(row,byId);
      const sourcePath=String((anchor||row)?.file||'');
      const line=parseLineStart((anchor||row)?.line_range);
      if(!sourcePath||!line)continue;

      const symbol=enclosingSymbol(topology,sourcePath,line);
      const external=!symbol?externalAtLine(topology,sourcePath,line):null;
      const key=`${spec.type}|${spec.name}|${sourcePath}|${line}`;
      if(seen.has(key))continue;
      seen.add(key);

      hits.push({
        sourcePath,
        line,
        endLine:Number(String((anchor||row)?.line_range||line).split('-')[1]||line),
        text:`${rowType} ${rowName}`,
        pattern:`${spec.type}:${spec.name}`,
        kind:'structured',
        weight:1,
        structuralScore:(spec.type==='*'?500:1000)+(rowType==='function'?50:0),
        matchQuality:{exact:spec.type==='*'?1:2,prefix:0,contains:0,filters:[]},
        symbolId:symbol?.id||'',
        symbolName:symbol?.name||anchor?.name||'',
        externalId:external?.id||'',
        externalName:external?.qualifiedName||external?.name||'',
        test:isTestPath(sourcePath),
        metadata:row
      });
      if(hits.length>=MAX_HITS)return hits;
    }
  }
  return hits;
}

function matcherFor(spec){
  try{return new RegExp(spec.pattern,'i')}catch{return null}
}

export async function scanRepositoryPatterns({topology,patterns=[]}){
  if(!topology?.repoDir||!arr(topology?.files).length)return [];
  const specs=normalizedPatterns(patterns).map(spec=>({...spec,matcher:matcherFor(spec)})).filter(spec=>spec.matcher);
  if(!specs.length)return [];
  const hits=[];
  for(const sourcePath of arr(topology.files)){
    if(hits.length>=MAX_HITS)break;
    const abs=path.join(topology.repoDir,sourcePath);
    const stat=await fs.stat(abs).catch(()=>null);
    if(!stat?.isFile()||stat.size>MAX_FILE_BYTES)continue;
    const body=await fs.readFile(abs,'utf8').catch(()=>'');
    if(!body)continue;
    const lines=body.split(/\r?\n/);
    for(let index=0;index<lines.length&&hits.length<MAX_HITS;index++){
      const lineText=lines[index],line=index+1;
      for(const spec of specs){
        spec.matcher.lastIndex=0;
        if(!spec.matcher.test(lineText))continue;
        const symbol=enclosingSymbol(topology,sourcePath,line);
        const external=!symbol?externalAtLine(topology,sourcePath,line):null;
        hits.push({
          sourcePath,line,text:text(lineText,420),pattern:spec.pattern,kind:spec.kind,weight:spec.weight,
          symbolId:symbol?.id||'',symbolName:symbol?.name||'',
          externalId:external?.id||'',externalName:external?.qualifiedName||external?.name||'',
          test:isTestPath(sourcePath)
        });
      }
    }
  }
  return hits;
}

export function rankPatternEntryHits(hits=[]){
  const grouped=new Map();
  for(const hit of arr(hits)){
    const key=hit.symbolId?'symbol:'+hit.symbolId:hit.externalId?'external:'+hit.externalId:'line:'+hit.sourcePath+':'+hit.line;
    const current=grouped.get(key)||{
      key,symbolId:hit.symbolId||'',externalId:hit.externalId||'',
      name:hit.symbolName||hit.externalName||hit.metadata?.name||'',
      sourcePath:hit.sourcePath,startLine:hit.line,endLine:hit.endLine||hit.line,test:!!hit.test,score:0,structuredScore:0,hasStructured:false,matches:[],metadata:hit.metadata||null
    };
    current.startLine=Math.min(current.startLine,hit.line);
    current.endLine=Math.max(current.endLine,hit.endLine||hit.line);
    if(hit.kind==='structured'){
      current.hasStructured=true;
      current.structuredScore=Math.max(current.structuredScore,Number(hit.structuralScore||0));
    }else{
      current.score+=Number(hit.weight||1)*10;
    }
    if(!current.matches.some(item=>item.pattern===hit.pattern&&item.line===hit.line))current.matches.push({pattern:hit.pattern,line:hit.line,text:hit.text,matchQuality:hit.matchQuality||null,metadata:hit.metadata||null});
    grouped.set(key,current);
  }
  const ranked=[...grouped.values()]
    .map(item=>{
      const score=item.hasStructured
        ? item.structuredScore+Math.min(20,item.matches.length)
        : item.score+(item.test?-50:25)+Math.min(20,item.matches.length*3);
      return {...item,score};
    })
    .sort((a,b)=>b.score-a.score||Number(a.test)-Number(b.test)||a.sourcePath.localeCompare(b.sourcePath));

  // Keep candidate diversity across extracted locators. A very common identifier
  // such as xr.Dataset must not crowd every other PAL match out of model triage.
  const chosen=[];
  const chosenKeys=new Set();
  const patterns=[...new Set(ranked.flatMap(item=>arr(item.matches).map(match=>match.pattern)).filter(Boolean))];
  for(const pattern of patterns){
    const candidate=ranked.find(item=>arr(item.matches).some(match=>match.pattern===pattern));
    if(candidate&&!chosenKeys.has(candidate.key)){
      chosen.push(candidate);chosenKeys.add(candidate.key);
    }
  }
  for(const candidate of ranked){
    if(chosen.length>=24)break;
    if(chosenKeys.has(candidate.key))continue;
    chosen.push(candidate);chosenKeys.add(candidate.key);
  }
  return chosen.slice(0,24);
}

function parseRelationIds(raw){
  if(Array.isArray(raw))return raw.map(String);
  const value=String(raw||'').trim();
  if(!value)return [];
  try{
    const parsed=JSON.parse(value);
    if(Array.isArray(parsed))return parsed.map(String);
  }catch{}
  return [value];
}

function compactLineWindow(lines,line,pad=3){
  const center=Math.max(1,Number(line||1));
  const start=Math.max(1,center-pad);
  const end=Math.min(lines.length,center+pad);
  const out=[];
  for(let n=start;n<=end;n+=1)out.push([n,String(lines[n-1]||'').slice(0,260)]);
  return out;
}

function rowDescriptor(row){
  if(!row)return null;
  return [
    String(row?.type||''),
    String(row?.name||''),
    String(row?.row||'')
  ];
}

function parentChain(row,byId,limit=8){
  const out=[];
  let current=row;
  const seen=new Set();
  while(current&&out.length<limit){
    const parentId=String(current?.parent||'');
    if(!parentId||seen.has(parentId))break;
    seen.add(parentId);
    const parent=byId.get(parentId);
    if(!parent)break;
    out.push(rowDescriptor(parent));
    current=parent;
  }
  return out;
}

function childChain(anchor,byId,limit=12){
  if(!anchor)return [];
  const out=[];
  const queue=parseRelationIds(anchor.children).map(id=>({id,depth:1}));
  const seen=new Set();
  while(queue.length&&out.length<limit){
    const item=queue.shift();
    if(!item?.id||seen.has(item.id))continue;
    seen.add(item.id);
    const row=byId.get(String(item.id));
    if(!row)continue;
    out.push([item.depth,...rowDescriptor(row)]);
    if(item.depth<2){
      for(const id of parseRelationIds(row.children))queue.push({id:String(id),depth:item.depth+1});
    }
  }
  return out;
}

async function entryNeighborhood(candidate,topology){
  const rows=arr(topology?.codeStructureRows);
  const byId=rowMap(rows);
  if(!rows.length||!topology?.repoDir)return null;

  const defaultRow=byId.get(String(candidate?.metadata?.row||''));
  const anchor=defaultRow?functionAnchor(defaultRow,byId):null;
  const structuralAnchor=anchor||defaultRow;
  if(!structuralAnchor)return null;

  const sourcePath=String(candidate?.sourcePath||structuralAnchor?.file||'');
  const body=sourcePath
    ? await fs.readFile(path.join(topology.repoDir,sourcePath),'utf8').catch(()=>'')
    : '';
  const lines=String(body||'').split(/\r?\n/);

  // Keep only last-mile source around actual PAL matches. One window per
  // distinct locator, capped to three, each exactly +/-3 lines.
  const matchWindows=[];
  const seenPatterns=new Set();
  for(const match of arr(candidate?.matches)){
    const pattern=String(match?.pattern||'');
    if(pattern&&seenPatterns.has(pattern))continue;
    if(pattern)seenPatterns.add(pattern);

    const row=byId.get(String(match?.metadata?.row||''))||defaultRow;
    const matchLine=Number(match?.line||String(row?.line_range||'').split('-')[0]||0);
    if(!matchLine)continue;
    matchWindows.push({
      locator:pattern,
      type:String(row?.type||''),
      name:String(row?.name||''),
      row:String(row?.row||''),
      line:matchLine,
      lines:compactLineWindow(lines,matchLine,3)
    });
    if(matchWindows.length>=3)break;
  }

  if(!matchWindows.length&&defaultRow){
    const line=Number(String(defaultRow?.line_range||'').split('-')[0]||0);
    if(line){
      matchWindows.push({
        locator:'',
        type:String(defaultRow?.type||''),
        name:String(defaultRow?.name||''),
        row:String(defaultRow?.row||''),
        line,
        lines:compactLineWindow(lines,line,3)
      });
    }
  }

  return {
    function:[String(structuralAnchor?.type||''),String(structuralAnchor?.name||candidate?.name||''),String(structuralAnchor?.row||'')],
    parents:parentChain(defaultRow||structuralAnchor,byId,8),
    children:childChain(structuralAnchor,byId,12),
    matches:matchWindows
  };
}

async function enrichEntryCandidates(candidates,topology){
  const enriched=[];
  for(const candidate of arr(candidates).slice(0,24)){
    const entryContext=await entryNeighborhood(candidate,topology);
    enriched.push({...candidate,entryContext});
  }
  return enriched;
}

export async function selectCodeEntries({question,mode,topology,client,model,usage,log=()=>{}}){
  const languages=[...new Set(arr(topology?.files).map(file=>path.extname(String(file||'')).toLowerCase()).filter(Boolean))].slice(0,12);
  const structuralRows=arr(topology?.codeStructureRows);

  if(structuralRows.length){
    const call=await modelJson(client,model,ENTRY_SELECT_SYSTEM,{q:question});
    addUsage(usage,call.usage);
    const plan=normalizeEntrySelectionPlan(call.parsed||{});

    if(plan.strategy==='structured_search'){
      const hits=topology?.palValuesIndex&&topology?.palUniqueIndex
        ? await scanCodeStructureRowsWithPal({topology,locators:plan.locators})
        : scanCodeStructureRows({topology,locators:plan.locators});
      const ranked=rankPatternEntryHits(hits);
      const candidates=await enrichEntryCandidates(ranked,topology);
      log('query_v5_entry_selection',{plan,hits:hits.slice(0,MAX_HITS),candidates,usage:call.usage});
      if(candidates.length)return {plan,hits,candidates,indexSummary:[]};
    }

    if(plan.strategy==='pattern_search'){
      const hits=await scanRepositoryPatterns({topology,patterns:plan.patterns});
      const candidates=rankPatternEntryHits(hits);
      log('query_v5_entry_selection',{plan,hits:hits.slice(0,MAX_HITS),candidates,usage:call.usage});
      return {plan,hits,candidates,indexSummary:[]};
    }

    const fallback={strategy:'root_entries',reason:plan.reason||'No exact structural row matched.',locators:plan.locators||[],patterns:[]};
    log('query_v5_entry_selection',{plan:fallback,hits:[],candidates:[],usage:call.usage});
    return {plan:fallback,hits:[],candidates:[],indexSummary:[]};
  }

  const call=await modelJson(client,model,ENTRY_SELECT_SYSTEM,{q:question});
  addUsage(usage,call.usage);
  const plan=normalizeEntrySelectionPlan(call.parsed||{});
  if(plan.strategy==='pattern_search'){
    const hits=await scanRepositoryPatterns({topology,patterns:plan.patterns});
    const candidates=rankPatternEntryHits(hits);
    log('query_v5_entry_selection',{plan,hits:hits.slice(0,MAX_HITS),candidates,usage:call.usage});
    return {plan,hits,candidates,indexSummary:[]};
  }
  return {plan:{strategy:'root_entries',reason:plan.reason||'',locators:[],patterns:[]},hits:[],candidates:[],indexSummary:[]};
}
