import fs from 'node:fs/promises';
import path from 'node:path';
import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';

const ENTRY_SELECT_SYSTEM = 'Navigate LeMap\'s structural code index as a short faceted tree walk before semantic exploration. The first payload gives top-level LeMap construct counts. Choose one construct when structural localization is useful. Subsequent payloads give only the current filtered row count plus compact facets. Refine one facet at a time using exact, prefix, or regex matching. Prefer exact when the issue supplies a concrete identifier or keyword, then prefix, then regex. You may request alphabetical facet ordering when names are more useful than frequency. Materialize rows once an exact or prefix refinement reduces the set to a small candidate set; do not keep refining merely because a frequent facet value exists. Additional refinement values must be grounded in the issue/question or be structurally discriminative, never guessed as causal. Use root_entries for end-to-end flow questions or when structural localization is not useful. Use pattern_search only when no structural index exists. Never infer causality here. Return one JSON action: {"action":"select_construct","construct":"call","reason":""}, {"action":"refine","field":"name","match":"exact|prefix|regex","value":"Field","facetSort":"count|alpha","reason":""}, {"action":"browse_facets","facetSort":"count|alpha","reason":""}, {"action":"show_rows","reason":""}, {"action":"pattern_search","patterns":[{"pattern":"","kind":"regex","weight":1}],"reason":""}, or {"action":"root_entries","reason":""}.';

const MAX_PATTERNS = 8;
const MAX_SEARCHES = 6;
const MAX_FILTERS = 4;
const MAX_FACET_STEPS = 3;
const MATERIALIZE_AT = 24;
const FACET_LIMIT = 12;
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

function escapeRegex(value=''){
  return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
}

function filterFromFacetAction(action={}){
  const field=String(action?.field||'').trim();
  const value=String(action?.value||'').trim();
  const match=String(action?.match||'exact').toLowerCase();
  if(!field||!value)return null;
  if(match==='exact')return {field,regex:'^'+escapeRegex(value)+'$',match:'exact',value};
  if(match==='prefix')return {field,regex:'^'+escapeRegex(value),match:'prefix',value};
  if(match==='regex'){try{new RegExp(value,'i')}catch{return null}return {field,regex:value,match:'regex',value};}
  return null;
}

function rowsForSelection(index=[],construct='',filters=[]){
  return arr(index).filter(row=>{
    if(construct&&String(row?.constructType||'').toLowerCase()!==construct)return false;
    return filters.every(filter=>!!fieldMatchQuality(row,filter));
  });
}

function facetEntries(rows,field,sort='count',limit=FACET_LIMIT){
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
  const entries=[...counts.entries()];
  entries.sort(sort==='alpha'?(x,y)=>x[0].localeCompare(y[0])||y[1]-x[1]:(x,y)=>y[1]-x[1]||x[0].localeCompare(y[0]));
  return entries.slice(0,limit).map(([value,count])=>[value,count]);
}

function facetView(rows=[],sort='count'){
  const excluded=new Set(['constructType','sourcePath','startLine','endLine','snippet','canonicalSnippet']);
  const fields=[...new Set(rows.flatMap(row=>Object.keys(row||{})).filter(key=>!excluded.has(key)))].sort();
  const facets={};
  for(const field of fields){const values=facetEntries(rows,field,sort);if(values.length)facets[field]=values;}
  return {count:rows.length,fields:Object.keys(facets),facets,sort};
}

function topLevelConstructCounts(index=[]){
  const counts=new Map();
  for(const row of arr(index)){const type=String(row?.constructType||'').trim().toLowerCase();if(type)counts.set(type,(counts.get(type)||0)+1);}
  return [...counts.entries()].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0])).map(([construct,count])=>({construct,count}));
}

function actionReason(action={}){return text(action?.reason||'',320);}

function materializeStructuredRows({topology,construct,filters,rows}){
  const hits=[];const seen=new Set();
  for(const row of arr(rows).slice(0,MAX_HITS)){
    const filterMatches=filters.map(filter=>fieldMatchQuality(row,filter)).filter(Boolean);
    const exactCount=filterMatches.filter(match=>match.quality==='exact').length;
    const prefixCount=filterMatches.filter(match=>match.quality==='prefix').length;
    const containsCount=filterMatches.filter(match=>match.quality==='contains').length;
    const structuralScore=exactCount*1000+prefixCount*100+containsCount*10+filters.length*5+1;
    const line=Number(row?.startLine||0);const sourcePath=String(row?.sourcePath||'');
    const key=[sourcePath,line,construct].join('|');if(seen.has(key))continue;seen.add(key);
    const symbol=enclosingSymbol(topology,sourcePath,line);const external=!symbol?externalAtLine(topology,sourcePath,line):null;
    hits.push({sourcePath,line,endLine:Number(row?.endLine||line),text:text(row?.snippet||'',700),pattern:filters.length?filters.map(filter=>filter.field+'~'+filter.regex).join(' & '):construct,kind:'structured',constructType:construct,weight:1,structuralScore,matchQuality:{exact:exactCount,prefix:prefixCount,contains:containsCount,filters:filterMatches},symbolId:symbol?.id||'',symbolName:symbol?.name||row?.parentFunction||row?.parentClass||'',externalId:external?.id||'',externalName:external?.qualifiedName||external?.name||'',test:isTestPath(sourcePath),metadata:row});
  }
  return hits;
}

export async function walkConstructFacets({question,mode,topology,client,model,usage}){
  const index=arr(topology?.constructIndex);
  if(!index.length)return {strategy:'unavailable',history:[],construct:'',filters:[],rows:[]};
  const counts=topLevelConstructCounts(index);const history=[];let construct='';let filters=[];let rows=index;let facetSort='count';
  for(let step=0;step<MAX_FACET_STEPS;step++){
    const payload=construct?{q:question,mode,step:step+1,selected:{construct,filters:filters.map(({field,match,value})=>({field,match,value}))},current:facetView(rows,facetSort),canMaterialize:true}:{q:question,mode,step:step+1,constructs:counts};
    const call=await modelJson(client,model,ENTRY_SELECT_SYSTEM,payload);addUsage(usage,call.usage);
    const action=call.parsed||{};history.push({step:step+1,action,usage:call.usage,currentCount:rows.length});
    const kind=String(action?.action||'').toLowerCase();
    if(!construct){
      if(kind==='select_construct'){const wanted=String(action?.construct||'').toLowerCase();if(!counts.some(item=>item.construct===wanted))break;construct=wanted;rows=rowsForSelection(index,construct,filters);if(rows.length<=MATERIALIZE_AT)break;continue;}
      if(kind==='pattern_search')return {strategy:'pattern_search',patterns:normalizedPatterns(action?.patterns),reason:actionReason(action),history,construct:'',filters:[],rows:[]};
      if(kind==='root_entries')return {strategy:'root_entries',reason:actionReason(action),history,construct:'',filters:[],rows:[]};
      break;
    }
    if(kind==='show_rows')break;
    if(kind==='root_entries')return {strategy:'root_entries',reason:actionReason(action),history,construct,filters,rows:[]};
    if(kind==='browse_facets'){facetSort=String(action?.facetSort||facetSort).toLowerCase()==='alpha'?'alpha':'count';continue;}
    if(kind==='refine'){facetSort=String(action?.facetSort||facetSort).toLowerCase()==='alpha'?'alpha':'count';const filter=filterFromFacetAction(action);const availableFields=new Set(facetView(rows,facetSort).fields);if(!filter||!availableFields.has(filter.field))break;filters=[...filters,filter];rows=rowsForSelection(index,construct,filters);if(rows.length<=MATERIALIZE_AT)break;continue;}
    break;
  }
  if(!construct)return {strategy:'root_entries',reason:'No usable structural branch selected.',history,construct:'',filters:[],rows:[]};
  return {strategy:'structured_search',reason:'Faceted structural tree walk.',history,construct,filters,rows};
}
function fieldMatchQuality(row,filter){
  let matcher;
  try{matcher=new RegExp(filter.regex,'i')}catch{return null}
  const raw=row?.[filter.field];
  const values=filter.field==='snippet'
    ? [raw,row?.canonicalSnippet]
    : Array.isArray(raw)?raw:[raw];
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
  if(indexSummary.length){
    const walked=await walkConstructFacets({question,mode,topology,client,model,usage});
    if(walked.strategy==='root_entries'){const plan={strategy:'root_entries',reason:walked.reason||'',searches:[],patterns:[],facetHistory:walked.history};log('query_v5_entry_selection',{plan,indexSummary,hits:[],candidates:[]});return {plan,hits:[],candidates:[],indexSummary};}
    if(walked.strategy==='pattern_search'){const hits=await scanRepositoryPatterns({topology,patterns:walked.patterns});const candidates=rankPatternEntryHits(hits);const plan={strategy:'pattern_search',reason:walked.reason||'',searches:[],patterns:walked.patterns,facetHistory:walked.history};log('query_v5_entry_selection',{plan,indexSummary,hits:hits.slice(0,MAX_HITS),candidates});return {plan,hits,candidates,indexSummary};}
    const hits=materializeStructuredRows({topology,construct:walked.construct,filters:walked.filters,rows:walked.rows});
    const candidates=rankPatternEntryHits(hits);
    const plan={strategy:'structured_search',reason:walked.reason||'',searches:[{construct:walked.construct,weight:1,filters:walked.filters.map(({field,regex})=>({field,regex}))}],patterns:[],facetHistory:walked.history,remainingRowCount:walked.rows.length};
    log('query_v5_entry_selection',{plan,indexSummary,hits:hits.slice(0,MAX_HITS),candidates});
    return {plan,hits,candidates,indexSummary};
  }
  const call=await modelJson(client,model,ENTRY_SELECT_SYSTEM,{q:question,mode,languages,index:{available:false}});addUsage(usage,call.usage);
  const action=call.parsed||{};const kind=String(action?.action||'').toLowerCase();const patterns=kind==='pattern_search'?normalizedPatterns(action?.patterns):[];
  if(patterns.length){const hits=await scanRepositoryPatterns({topology,patterns});const candidates=rankPatternEntryHits(hits);const plan={strategy:'pattern_search',reason:actionReason(action),searches:[],patterns};log('query_v5_entry_selection',{plan,indexSummary,hits:hits.slice(0,MAX_HITS),candidates,usage:call.usage});return {plan,hits,candidates,indexSummary};}
  const plan={strategy:'root_entries',reason:actionReason(action),searches:[],patterns:[]};log('query_v5_entry_selection',{plan,indexSummary,hits:[],candidates:[],usage:call.usage});return {plan,hits:[],candidates:[],indexSummary};
}
