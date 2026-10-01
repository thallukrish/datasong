import fs from 'node:fs/promises';
import path from 'node:path';
import { addUsage, arr, modelJson, text } from '../query_v2/modelJson.js';

const ENTRY_SELECT_SYSTEM = 'Choose how LeMap should find promising starting points before code-flow exploration. Use "pattern_search" when the issue/question contains concrete source signatures that can be searched directly, such as API/function names, exception/warning text, keyword arguments, metadata keys, decorators, annotations, constants, config keys, table/field names, or distinctive code fragments. Use "root_entries" when the request is primarily about end-to-end behavior or a flow and there is no useful source signature. For pattern_search, return a small set of source-code patterns that a grep-like repository scan should look for. Prefer precise literals. Regex is allowed only when it materially improves the search. Do not include natural-language paraphrases that are unlikely to occur in source. Return {"strategy":"pattern_search|root_entries","reason":"","patterns":[{"pattern":"","kind":"literal|regex","weight":1}]}. Use at most 8 patterns. weight is 1..5.';

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
    const kind=String(item?.kind||'literal').toLowerCase()==='regex'?'regex':'literal';
    const weight=Math.max(1,Math.min(5,Number(item?.weight||1)));
    out.push({pattern,kind,weight});
  }
  return out;
}

export function normalizeEntrySelectionPlan(parsed={}){
  const strategy=String(parsed?.strategy||'root_entries').toLowerCase()==='pattern_search'?'pattern_search':'root_entries';
  const patterns=strategy==='pattern_search'?normalizedPatterns(parsed?.patterns):[];
  return {strategy:patterns.length?'pattern_search':'root_entries',reason:text(parsed?.reason||'',320),patterns};
}

function matcherFor(spec){
  if(spec.kind==='regex'){
    try{return new RegExp(spec.pattern,'i')}catch{return null}
  }
  const needle=spec.pattern.toLowerCase();
  return {test:(value)=>String(value||'').toLowerCase().includes(needle)};
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
      sourcePath:hit.sourcePath,startLine:hit.line,endLine:hit.line,test:!!hit.test,score:0,matches:[]
    };
    current.startLine=Math.min(current.startLine,hit.line);
    current.endLine=Math.max(current.endLine,hit.line);
    current.score+=Number(hit.weight||1)*10;
    if(!current.matches.some(item=>item.pattern===hit.pattern&&item.line===hit.line))current.matches.push({pattern:hit.pattern,line:hit.line,text:hit.text});
    grouped.set(key,current);
  }
  return [...grouped.values()]
    .map(item=>({...item,score:item.score+(item.test?-50:25)+Math.min(20,item.matches.length*3)}))
    .sort((a,b)=>b.score-a.score||Number(a.test)-Number(b.test)||a.sourcePath.localeCompare(b.sourcePath))
    .slice(0,24);
}

export async function selectCodeEntries({question,mode,topology,client,model,usage,log=()=>{}}){
  const call=await modelJson(client,model,ENTRY_SELECT_SYSTEM,{q:question,mode});addUsage(usage,call.usage);
  const plan=normalizeEntrySelectionPlan(call.parsed||{});
  if(plan.strategy!=='pattern_search'){
    log('query_v5_entry_selection',{plan,hits:[],candidates:[],usage:call.usage});
    return {plan,hits:[],candidates:[]};
  }
  const hits=await scanRepositoryPatterns({topology,patterns:plan.patterns});
  const candidates=rankPatternEntryHits(hits);
  log('query_v5_entry_selection',{plan,hits:hits.slice(0,MAX_HITS),candidates,usage:call.usage});
  return {plan,hits,candidates};
}
