import fs from 'node:fs/promises';
import path from 'node:path';
import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';

const ENTRY_SELECT_SYSTEM = `Locate existing code from the issue using LeMap's PAL-indexed structural CSV rows.

Each row has:
row, file, line_range, type, name, parent, children, callers, callees.

Return only exact identifiers that the issue gives enough evidence to search for. Prefer a typed locator when syntax makes the type clear. Use type "*" when the name is useful but the construct type is uncertain. Do not infer proposed implementation identifiers as if they already exist.

Return one of:
{"action":"locate","locators":[{"type":"function|class|input_param|call|assignment|if|for|while|try|except|with|return|exception|expression|*","name":"exact name"}],"reason":""}
{"action":"pattern_search","patterns":[{"pattern":"regex","kind":"regex","weight":1}],"reason":""}
{"action":"root_entries","reason":""}

Keep locators compact and exact. Up to 6 locators.`;

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
    const name=String(item?.name||'').trim();
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
  const locators=requested==='locate'||requested==='structured_search'
    ? normalizedLocators(parsed?.locators||parsed?.searches)
    : [];
  const patterns=requested==='pattern_search'?normalizedPatterns(parsed?.patterns):[];
  const strategy=locators.length?'structured_search':patterns.length?'pattern_search':'root_entries';
  return {strategy,reason:text(parsed?.reason||'',320),locators,patterns};
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
      key,symbolId:hit.symbolId||'',externalId:hit.externalId||'',name:hit.symbolName||hit.externalName||'',
      sourcePath:hit.sourcePath,startLine:hit.line,endLine:hit.endLine||hit.line,test:!!hit.test,score:0,structuredScore:0,hasStructured:false,matches:[]
    };
    current.startLine=Math.min(current.startLine,hit.line);
    current.endLine=Math.max(current.endLine,hit.endLine||hit.line);
    if(hit.kind==='structured'){
      current.hasStructured=true;
      current.structuredScore=Math.max(current.structuredScore,Number(hit.structuralScore||0));
    }else{
      current.score+=Number(hit.weight||1)*10;
    }
    if(!current.matches.some(item=>item.pattern===hit.pattern&&item.line===hit.line))current.matches.push({pattern:hit.pattern,line:hit.line,text:hit.text,matchQuality:hit.matchQuality||null});
    grouped.set(key,current);
  }
  return [...grouped.values()]
    .map(item=>{
      const score=item.hasStructured
        ? item.structuredScore+Math.min(20,item.matches.length)
        : item.score+(item.test?-50:25)+Math.min(20,item.matches.length*3);
      return {...item,score};
    })
    .sort((a,b)=>b.score-a.score||Number(a.test)-Number(b.test)||a.sourcePath.localeCompare(b.sourcePath))
    .slice(0,24);
}

export async function selectCodeEntries({question,mode,topology,client,model,usage,log=()=>{}}){
  const languages=[...new Set(arr(topology?.files).map(file=>path.extname(String(file||'')).toLowerCase()).filter(Boolean))].slice(0,12);
  const structuralRows=arr(topology?.codeStructureRows);

  if(structuralRows.length){
    const call=await modelJson(client,model,ENTRY_SELECT_SYSTEM,{
      q:question,
      mode,
      languages,
      index:{available:true,engine:topology?.palValuesIndex?'pal':'rows',columns:['row','file','line_range','type','name','parent','children','callers','callees']}
    });
    addUsage(usage,call.usage);
    const plan=normalizeEntrySelectionPlan(call.parsed||{});

    if(plan.strategy==='structured_search'){
      const hits=scanCodeStructureRows({topology,locators:plan.locators});
      const candidates=rankPatternEntryHits(hits);
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

  const call=await modelJson(client,model,ENTRY_SELECT_SYSTEM,{q:question,mode,languages,index:{available:false}});
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
