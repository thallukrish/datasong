import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import simpleGit from 'simple-git';

const clean = (v='') => String(v||'').trim();
function attr(raw, name) {
  const m = String(raw||'').match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'));
  return m ? m[1] : '';
}
function humanize(name='') {
  return clean(name).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
}
function stripTags(s='') { return clean(String(s).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')); }
function uniqBy(values, keyFn) {
  const out=[]; const seen=new Set();
  for(const value of values||[]){const key=keyFn(value);if(!key||seen.has(key))continue;seen.add(key);out.push(value)}
  return out;
}
function repoKey(url=''){return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0,16)}

const MOQUI_FRAMEWORK_REPO = 'https://github.com/moqui/moqui-framework';

// Moqui component names are not necessarily GitHub repository names. Keep this
// mapping inside the Moqui-specific adapter; generic repository discovery stays
// unaware of Moqui packaging conventions.
const KNOWN_COMPONENT_REPOS = {
  'SimpleScreens': 'https://github.com/moqui/SimpleScreens',
  'mantle-usl': 'https://github.com/moqui/mantle-usl',
  'mantle-udm': 'https://github.com/moqui/mantle-udm',
  'moqui-fop': 'https://github.com/moqui/moqui-fop'
};

function parseDepends(xml='') {
  const out=[]; const re=/<depends-on\b([^>]*?)\/>/gi; let m;
  while((m=re.exec(xml))){const name=attr(m[1],'name');if(name)out.push(name)}
  return [...new Set(out)];
}

function parseFields(body='') {
  const fields=[]; const fieldRe=/<field\b([^>]*?)(?:\/>|>([\s\S]*?)<\/field>)/gi; let fm;
  while ((fm=fieldRe.exec(body))) {
    const fa=fm[1]||'', fb=fm[2]||''; const name=attr(fa,'name'); if(!name)continue;
    const fd=fb.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i);
    fields.push({name,type:attr(fa,'type'),isPk:/\bis-pk=["']true["']/i.test(fa),defaultValue:attr(fa,'default-value'),description:fd?stripTags(fd[1]):'',label:humanize(name)});
  }
  return fields;
}
function parseRelationships(body='') {
  const relationships=[]; const relRe=/<relationship\b([^>]*?)(?:\/>|>([\s\S]*?)<\/relationship>)/gi; let rm;
  while((rm=relRe.exec(body))){
    const ra=rm[1]||'', rb=rm[2]||'';
    const keyMaps=[]; const km=/<key-map\b([^>]*?)\/>/gi; let k;
    while((k=km.exec(rb))) keyMaps.push({
      fieldName:attr(k[1],'field-name'),
      // `related` is the canonical Moqui attribute; related-field-name is deprecated.
      relatedFieldName:attr(k[1],'related')||attr(k[1],'related-field-name')
    });
    relationships.push({type:attr(ra,'type'),relatedEntityName:attr(ra,'related')||attr(ra,'related-entity-name'),title:attr(ra,'title'),shortAlias:attr(ra,'short-alias'),keyMaps});
  }
  return relationships;
}

export function extractMoquiEntitySchemas(sourcePath, xml, component='') {
  const out=[];
  const entityRe=/<(?:entity|view-entity)\b([^>]*)>([\s\S]*?)<\/(?:entity|view-entity)>/gi; let em;
  while ((em=entityRe.exec(xml))) {
    const attrs=em[1]||'', body=em[2]||''; const entityName=attr(attrs,'entity-name')||attr(attrs,'name'); if(!entityName)continue;
    const packageName=attr(attrs,'package-name')||attr(attrs,'package'); const fullName=packageName?`${packageName}.${entityName}`:entityName;
    const descMatch=body.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i);
    const fields=parseFields(body);
    // View entities expose aliases as queryable fields even when there are no <field> tags.
    const aliasRe=/<alias\b([^>]*?)\/>/gi; let am;
    while((am=aliasRe.exec(body))){const aa=am[1]||'',name=attr(aa,'name');if(!name)continue;fields.push({name,type:'derived',isPk:false,defaultValue:'',description:'',label:humanize(name),sourceField:attr(aa,'field'),entityAlias:attr(aa,'entity-alias')})}
    out.push({name:entityName,fullName,packageName,description:descMatch?stripTags(descMatch[1]):'',sourcePath,component,fields:uniqBy(fields,f=>f.name),relationships:parseRelationships(body),definitionKind:/<view-entity\b/i.test(em[0])?'view-entity':'entity'});
  }

  // Extensions add fields/relationships to entities defined in another component.
  const extRe=/<extend-entity\b([^>]*)>([\s\S]*?)<\/extend-entity>/gi; let ex;
  while((ex=extRe.exec(xml))){const attrs=ex[1]||'',body=ex[2]||'',name=attr(attrs,'entity-name')||attr(attrs,'name');if(!name)continue;const packageName=attr(attrs,'package-name')||attr(attrs,'package');out.push({name,fullName:packageName?`${packageName}.${name}`:name,packageName,description:'',sourcePath,component,fields:parseFields(body),relationships:parseRelationships(body),definitionKind:'extend-entity',extension:true})}
  return out;
}

export class MoquiEntitySchemaAdapter {
  constructor(topology){ this.topology=topology; }

  async ensureRepo(url){
    if(!url)return null;
    const root=path.join(this.topology.cacheRoot,'moqui-schema-deps'); await fs.mkdir(root,{recursive:true});
    const dir=path.join(root,repoKey(url));
    const gitDir=path.join(dir,'.git');
    try{await fs.stat(gitDir);const git=simpleGit(dir);await git.fetch(['origin','--depth','1']);await git.reset(['--hard','FETCH_HEAD']);}
    catch{await fs.rm(dir,{recursive:true,force:true});await simpleGit().clone(url,dir,['--depth','1']);}
    return dir;
  }

  async ensureDependencyRepo(name){
    const url=KNOWN_COMPONENT_REPOS[name]; if(!url)return null;
    return this.ensureRepo(url);
  }

  async frameworkRoot(){
    const dir=await this.ensureRepo(MOQUI_FRAMEWORK_REPO).catch(()=>null);
    return dir ? {name:'moqui-framework',dir} : null;
  }

  async dependencyRoots(){
    const roots=[]; const queued=[]; const seen=new Set();
    const localComponent=await fs.readFile(path.join(this.topology.repoDir,'component.xml'),'utf8').catch(()=> '');
    queued.push(...parseDepends(localComponent));
    while(queued.length){const name=queued.shift();if(seen.has(name))continue;seen.add(name);const dir=await this.ensureDependencyRepo(name).catch(()=>null);if(!dir)continue;roots.push({name,dir});const component=await fs.readFile(path.join(dir,'component.xml'),'utf8').catch(()=> '');queued.push(...parseDepends(component));}
    return roots;
  }

  async xmlFilesUnder(rootDir){
    const git=simpleGit(rootDir); return (await git.raw(['ls-files'])).split(/\r?\n/).map(x=>x.trim()).filter(f=>/\.xml$/i.test(f));
  }

  async schemasFromRoot(rootDir, component, prefix='', includeFile=()=>true){
    const schemas=[]; const files=(await this.xmlFilesUnder(rootDir).catch(()=>[])).filter(includeFile);
    for(const rel of files){const xml=await fs.readFile(path.join(rootDir,rel),'utf8').catch(()=> '');if(!xml||!/<(?:entity|view-entity|extend-entity)\b/i.test(xml))continue;schemas.push(...extractMoquiEntitySchemas(`${prefix}${rel}`,xml,component));}
    return schemas;
  }

  mergeSchemas(raw){
    const base=new Map(); const extensions=[];
    for(const s of raw){if(s.extension){extensions.push(s);continue}for(const key of [s.fullName,s.name].filter(Boolean)){const existing=base.get(key);if(!existing||(!existing.fields.length&&s.fields.length))base.set(key,s)}}
    const unique=uniqBy([...base.values()],s=>s.fullName||s.name);
    const find=(s)=>unique.find(x=>x.fullName===s.fullName||x.name===s.name||x.fullName.endsWith(`.${s.name}`));
    for(const ext of extensions){let target=find(ext);if(!target){target={...ext,extension:false,definitionKind:'external-extension-base',fields:[],relationships:[]};unique.push(target)}target.fields=uniqBy([...(target.fields||[]),...(ext.fields||[])],f=>f.name);target.relationships=uniqBy([...(target.relationships||[]),...(ext.relationships||[])],r=>`${r.type}|${r.relatedEntityName}|${r.title}`)}
    return unique;
  }

  async augment(){
    const localTracked=Array.isArray(this.topology?.trackedFiles)?this.topology.trackedFiles:[];
    const localSchemas=[];
    for(const sourcePath of localTracked.filter(f=>/\.xml$/i.test(f))){const xml=await fs.readFile(path.join(this.topology.repoDir,sourcePath),'utf8').catch(()=> '');if(!xml||!/<(?:entity|view-entity|extend-entity)\b/i.test(xml))continue;localSchemas.push(...extractMoquiEntitySchemas(sourcePath,xml,'local'))}

    const framework=await this.frameworkRoot();
    const frameworkSchemas=framework
      ? await this.schemasFromRoot(framework.dir,framework.name,'framework-repo/',rel=>/^framework\/entity\/.*\.xml$/i.test(rel))
      : [];

    const deps=await this.dependencyRoots(); const dependencySchemas=[];
    for(const dep of deps) dependencySchemas.push(...await this.schemasFromRoot(dep.dir,dep.name,`dependency/${dep.name}/`));
    const schemas=this.mergeSchemas([...frameworkSchemas,...localSchemas,...dependencySchemas]);
    const byName=new Map();
    for(const s of schemas){for(const key of [s.name,s.fullName].filter(Boolean))if(!byName.has(key))byName.set(key,s);if(s.fullName?.includes('.')){const leaf=s.fullName.split('.').at(-1);if(!byName.has(leaf))byName.set(leaf,s)}}
    this.topology.entitySchemas=schemas; this.topology.entitySchemaByName=byName;
    return {adapter:'moqui-entity-schema-v3',entities:schemas.length,fields:schemas.reduce((n,s)=>n+(s.fields?.length||0),0),frameworkComponent:framework?.name||'',frameworkEntities:frameworkSchemas.length,dependencyComponents:deps.map(d=>d.name)};
  }
}
