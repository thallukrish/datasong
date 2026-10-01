import fs from 'node:fs/promises';
import path from 'node:path';
import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';

const ENTRY_SELECT_SYSTEM = 'Choose how LeMap should localize promising starting code before semantic exploration. The payload contains repository languages and, when available, a structural code index summary with construct types, counts, searchable fields and compact facets. Prefer "structured_search" when that index can express the likely source. Select one or more construct types and give regex filters over their indexed metadata fields. Filters within one search are ANDed; multiple searches are ORed. Use issue vocabulary directly when it is a useful anchor. Use facets only to discover repository-specific vocabulary when the issue itself is insufficient. Do not ask to inspect hundreds of raw rows. Use "pattern_search" only when no useful structural index is available; then emit syntax-respecting source regex. Use "root_entries" for end-to-end flow questions or when there is no useful localization. Search only localizes candidates; it does not infer causality. Return {"strategy":"structured_search|pattern_search|root_entries","reason":"","searches":[{"construct":"","weight":1,"filters":[{"field":"","regex":""}]}],"patterns":[{"pattern":"","kind":"regex","weight":1}]}. Use at most 6 structured searches, 4 filters per search, or 8 raw patterns. weight is 1..5.';

const MAX_PATTERNS = 8;
const MAX_SEARCHES = 6;
const MAX_FILTERS = 4;
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
    out.push({pattern,kind:'regex',weight});
  }
  return out;
}

function normalizedSearches(items=[],availableTypes=new Set()){
  const out=[];
  for(const item of arr(items).slice(0,MAX_SEARCHES)){
    const construct=String(item?.construct||'').trim().toLowerCase();
    if(!construct||(availableTypes.size&&!availableTypes.has(construct)))continue;
    const filters=[];
    for(const filter of arr(item?.filters).slice(0,MAX_FILTERS)){
      const field=String(filter?.field||'').trim();
      const regex=String(filter?.regex||'').trim();
      if(!field||!regex||regex.length>220)continue;
      try{new RegExp(regex,'i')}catch{continue}
      filters.push({field,regex});
    }
    if(!filters.length)continue;
    const weight=Math.max(1,Math.min(5,Number(item?.weight||1)));
    out.push({construct,weight,filters});
  }
  return out;
}

function facetValues(rows,field,limit=12){
  const counts=new Map();
  for(const row of rows){
    const raw=row?.[field];
    const values=Array.isArray(raw)?raw:[raw];
    for(const value of values){
      const key=String(value??'').trim();
      if(!key||key.length>120)continue;
      counts.set(key,(counts.get(key)||0)+1);
    }
  }
  return [...counts.entries()]
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
    .slice(0,limit)
    .map(([value,count])=>[value,count]);
}

export function constructIndexSummary(index=[]){
  const grouped=new Map();
  for(const row of arr(index)){
    const type=String(row?.constructType||'').trim().toLowerCase();
    if(!type)continue;
    if(!grouped.has(type))grouped.set(type,[]);
    grouped.get(type).push(row);
  }
  return [...grouped.entries()].map(([construct,rows])=>{
    const fields=[...new Set(rows.flatMap(row=>Object.keys(row||{})).filter(key=>!['constructType','sourcePath','startLine','endLine'].includes(key)))].sort();
    const facets={};
    for(const field of ['name','module','qualifiedName','parentFunction','parentClass','keywordArgs']){
      const values=facetValues(rows,field);
      if(values.length)facets[field]=values;
    }
    return {construct,count:rows.length,fields,facets};
  }).sort((a,b)=>b.count-a.count||a.construct.localeCompare(b.construct));
}

function fieldMatchQuality(row,filter){
  let matcher;
  try{matcher=new RegExp(filter.regex,'i')}catch{return null}
  const raw=row?.[filter.field];
  const values=Array.isArray(raw)?raw:[raw];
  let best=null;
  for(const value of values){
    const candidate=String(value??'');
    matcher.lastIndex=0;
    const match=matcher.exec(candidate);
    if(!match)continue;
    const quality=match.index===0&&match[0].length===candidate.length?'exact':match.index===0?'prefix':'contains';
    const rank=quality==='exact'?3:quality==='prefix'?2:1;
    if(!best||rank>best.rank)best={field:filter.field,regex:filter.regex,value:candidate,quality,rank};
  }
  return best;
}

export function scanConstructIndex({topology,searches=[]}){
  const index=arr(topology?.constructIndex);
  if(!index.length)return [];
  const availableTypes=new Set(index.map(row=>String(row?.constructType||'').toLowerCase()).filter(Boolean));
  const specs=normalizedSearches(searches,availableTypes);
  const hits=[];
  const seen=new Set();
  for(const spec of specs){
    for(const row of index){
      if(hits.length>=MAX_HITS)break;
      if(String(row?.constructType||'').toLowerCase()!==spec.construct)continue;
      const filterMatches=spec.filters.map(filter=>fieldMatchQuality(row,filter));
      if(filterMatches.some(match=>!match))continue;
      const exactCount=filterMatches.filter(match=>match.quality==='exact').length;
      const prefixCount=filterMatches.filter(match=>match.quality==='prefix').length;
      const containsCount=filterMatches.filter(match=>match.quality==='contains').length;
      const structuralScore=exactCount*1000+prefixCount*100+containsCount*10+spec.filters.length*5+Number(spec.weight||1);
      const line=Number(row?.startLine||0);
      const sourcePath=String(row?.sourcePath||'');
      const key=[sourcePath,line,spec.construct,JSON.stringify(spec.filters)].join('|');
      if(seen.has(key))continue;
      seen.add(key);
      const symbol=enclosingSymbol(topology,sourcePath,line);
      const external=!symbol?externalAtLine(topology,sourcePath,line):null;
      hits.push({
        sourcePath,
        line,
        endLine:Number(row?.endLine||line),
        text:text(row?.snippet||'',700),
        pattern:spec.filters.map(filter=>`${filter.field}~${filter.regex}`).join(' & '),
        kind:'structured',
        constructType:spec.construct,
        weight:spec.weight,
        structuralScore,
        matchQuality:{exact:exactCount,prefix:prefixCount,contains:containsCount,filters:filterMatches},
        symbolId:symbol?.id||'',
        symbolName:symbol?.name||row?.parentFunction||row?.parentClass||'',
        externalId:external?.id||'',
        externalName:external?.qualifiedName||external?.name||'',
        test:isTestPath(sourcePath),
        metadata:row
      });
    }
  }
  return hits;
}

export function normalizeEntrySelectionPlan(parsed={},indexSummary=[]){
  const requested=String(parsed?.strategy||'root_entries').toLowerCase();
  const availableTypes=new Set(arr(indexSummary).map(item=>String(item?.construct||'').toLowerCase()).filter(Boolean));
  const searches=requested==='structured_search'?normalizedSearches(parsed?.searches,availableTypes):[];
  const patterns=requested==='pattern_search'?normalizedPatterns(parsed?.patterns):[];
  const strategy=searches.length?'structured_search':patterns.length?'pattern_search':'root_entries';
  return {strategy,reason:text(parsed?.reason||'',320),searches,patterns};
}

function matcherFor(spec){
  try{return new RegExp(spec.pattern,'i')}catch{return null}
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
  const indexSummary=constructIndexSummary(topology?.constructIndex);
  const call=await modelJson(client,model,ENTRY_SELECT_SYSTEM,{q:question,mode,languages,index:{available:indexSummary.length>0,constructs:indexSummary}});addUsage(usage,call.usage);
  const plan=normalizeEntrySelectionPlan(call.parsed||{},indexSummary);
  let hits=[];
  if(plan.strategy==='structured_search')hits=scanConstructIndex({topology,searches:plan.searches});
  else if(plan.strategy==='pattern_search')hits=await scanRepositoryPatterns({topology,patterns:plan.patterns});
  else{
    log('query_v5_entry_selection',{plan,indexSummary,hits:[],candidates:[],usage:call.usage});
    return {plan,hits:[],candidates:[],indexSummary};
  }
  const candidates=rankPatternEntryHits(hits);
  log('query_v5_entry_selection',{plan,indexSummary,hits:hits.slice(0,MAX_HITS),candidates,usage:call.usage});
  return {plan,hits,candidates,indexSummary};
}
