import fs from 'node:fs/promises';
import path from 'node:path';

const clean = (v='') => String(v||'').trim();
function attr(raw, name) {
  const m = String(raw||'').match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'));
  return m ? m[1] : '';
}
function humanize(name='') {
  return clean(name).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
}
function stripTags(s='') { return clean(String(s).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')); }

export function extractMoquiEntitySchemas(sourcePath, xml) {
  const out=[];
  const entityRe=/<(?:entity|view-entity)\b([^>]*)>([\s\S]*?)<\/(?:entity|view-entity)>/gi;
  let em;
  while ((em=entityRe.exec(xml))) {
    const attrs=em[1]||'', body=em[2]||'';
    const entityName=attr(attrs,'entity-name')||attr(attrs,'name');
    if (!entityName) continue;
    const packageName=attr(attrs,'package-name');
    const fullName=packageName ? `${packageName}.${entityName}` : entityName;
    const descMatch=body.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i);
    const fields=[];
    const fieldRe=/<field\b([^>]*?)(?:\/>|>([\s\S]*?)<\/field>)/gi;
    let fm;
    while ((fm=fieldRe.exec(body))) {
      const fa=fm[1]||'', fb=fm[2]||'';
      const name=attr(fa,'name'); if(!name) continue;
      const fd=fb.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i);
      fields.push({
        name,
        type: attr(fa,'type'),
        isPk: /\bis-pk=["']true["']/i.test(fa),
        defaultValue: attr(fa,'default-value'),
        description: fd ? stripTags(fd[1]) : '',
        label: humanize(name)
      });
    }
    const relationships=[];
    const relRe=/<relationship\b([^>]*?)(?:\/>|>([\s\S]*?)<\/relationship>)/gi;
    let rm;
    while((rm=relRe.exec(body))) {
      const ra=rm[1]||'';
      relationships.push({
        type: attr(ra,'type'),
        relatedEntityName: attr(ra,'related-entity-name'),
        title: attr(ra,'title'),
        shortAlias: attr(ra,'short-alias')
      });
    }
    out.push({
      name: entityName,
      fullName,
      packageName,
      description: descMatch ? stripTags(descMatch[1]) : '',
      sourcePath,
      fields,
      relationships
    });
  }
  return out;
}

export class MoquiEntitySchemaAdapter {
  constructor(topology){ this.topology=topology; }
  async augment(){
    const tracked=Array.isArray(this.topology?.trackedFiles)?this.topology.trackedFiles:[];
    const xmlFiles=tracked.filter(f=>/\.xml$/i.test(f));
    const schemas=[];
    for(const sourcePath of xmlFiles){
      const xml=await fs.readFile(path.join(this.topology.repoDir,sourcePath),'utf8').catch(()=> '');
      if(!xml || !/<(?:entity|view-entity)\b/i.test(xml)) continue;
      schemas.push(...extractMoquiEntitySchemas(sourcePath,xml));
    }
    const byName=new Map();
    for(const s of schemas){
      for(const key of [s.name,s.fullName].filter(Boolean)) if(!byName.has(key)) byName.set(key,s);
    }
    this.topology.entitySchemas=schemas;
    this.topology.entitySchemaByName=byName;
    return {adapter:'moqui-entity-schema-v1',entities:schemas.length,fields:schemas.reduce((n,s)=>n+s.fields.length,0)};
  }
}
