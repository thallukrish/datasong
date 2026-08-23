import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BATCH_SIZE = 50;
const arr = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 240) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];

function usageOf(usage = {}) {
  const prompt = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const completion = Number(usage.completion_tokens || usage.output_tokens || 0);
  return { prompt, completion, total:Number(usage.total_tokens || prompt + completion) };
}
function addUsage(total, usage) {
  total.prompt += Number(usage?.prompt || 0);
  total.completion += Number(usage?.completion || 0);
  total.total += Number(usage?.total || 0);
}
function parseJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}
function entityCatalog(arcs = []) {
  const out = new Map();
  for (const arc of arr(arcs)) {
    for (const detail of arr(arc?.entityDetails)) {
      const name = text(detail?.name, 120);
      if (!name) continue;
      const k = key(name);
      const current = out.get(k) || { name, description:'' };
      const description = text(detail?.description, 260);
      if (!current.description && description) current.description = description;
      out.set(k, current);
    }
    for (const name0 of [...arr(arc?.entities), ...arr(arc?.persistentObjects)]) {
      const name = text(name0, 120);
      if (name && !out.has(key(name))) out.set(key(name), { name, description:'' });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function directoryFile(dataRoot, repoUrl, commit) {
  const id = crypto.createHash('sha1').update(`${repoUrl || ''}|${commit || ''}`).digest('hex').slice(0, 16);
  const dir = path.join(dataRoot, 'entity-directory');
  fs.mkdirSync(dir, { recursive:true });
  return path.join(dir, `${id}.json`);
}
function load(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function save(file, state) {
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
}
async function modelJson(client, model, system, payload) {
  const completion = await client.chat.completions.create({
    model,
    messages:[{ role:'system', content:`Return JSON only. ${system}` }, { role:'user', content:JSON.stringify(payload) }],
    response_format:{ type:'json_object' },
    thinking:{ type:'disabled' },
    temperature:0
  });
  const raw = completion.choices?.[0]?.message?.content || '{}';
  return { parsed:parseJson(raw), raw, usage:usageOf(completion.usage || {}) };
}
function ensureGroup(groups, name, description = '') {
  const clean = text(name, 100);
  if (!clean) return '';
  const found = groups.find((g) => key(g.name) === key(clean));
  if (found) {
    if (!found.description && description) found.description = text(description, 220);
    return found.name;
  }
  groups.push({ name:clean, description:text(description, 220) });
  return clean;
}
function applyBatch(state, batch, result) {
  for (const group of arr(result?.newGroups)) ensureGroup(state.groups, group?.name, group?.description);
  const byEntity = new Map(arr(result?.assignments).map((item) => [key(item?.entity), item]));
  for (const entity of batch) {
    const item = byEntity.get(key(entity.name));
    const assigned = [];
    for (const groupName of arr(item?.groups).slice(0, 4)) {
      const canonical = ensureGroup(state.groups, groupName, '');
      if (canonical) assigned.push(canonical);
    }
    state.assignments[entity.name] = uniq(assigned);
  }
}
function representatives(state, groupName, limit = 6) {
  return Object.entries(state.assignments)
    .filter(([, groups]) => arr(groups).some((g) => key(g) === key(groupName)))
    .map(([entity]) => entity)
    .slice(0, limit);
}
function applyReconciliation(state, result) {
  const canonical = arr(result?.groups).filter((g) => text(g?.name, 100));
  if (!canonical.length) return;
  const sourceToTarget = new Map();
  const nextGroups = [];
  for (const group of canonical) {
    const target = text(group.name, 100);
    nextGroups.push({ name:target, description:text(group.description, 220) });
    const sources = arr(group.sourceGroups).length ? arr(group.sourceGroups) : [target];
    for (const source of sources) sourceToTarget.set(key(source), target);
  }
  for (const old of state.groups) {
    if (sourceToTarget.has(key(old.name))) continue;
    nextGroups.push(old);
    sourceToTarget.set(key(old.name), old.name);
  }
  const deduped = [];
  for (const group of nextGroups) {
    if (!deduped.some((g) => key(g.name) === key(group.name))) deduped.push(group);
  }
  for (const [entity, groups] of Object.entries(state.assignments)) {
    state.assignments[entity] = uniq(arr(groups).map((g) => sourceToTarget.get(key(g)) || g));
  }
  state.groups = deduped;
}

export async function ensureEntityDirectory({ client, model, arcs, dataRoot, repoUrl = '', commit = '', log = () => {} }) {
  const entities = entityCatalog(arcs);
  const file = directoryFile(dataRoot, repoUrl, commit);
  const signature = crypto.createHash('sha1').update(entities.map((e) => `${e.name}|${e.description}`).join('\n')).digest('hex');
  let state = load(file);
  if (!state || state.signature !== signature) {
    console.log(`[lemap directory] creating directory: ${entities.length} entities, batch size ${BATCH_SIZE}`);
    state = { version:1, repoUrl, commit, signature, entityCount:entities.length, batchSize:BATCH_SIZE, nextIndex:0, groups:[], assignments:{}, complete:false, reconciled:false, updatedAt:new Date().toISOString() };
    save(file, state);
  } else {
    console.log(`[lemap directory] loaded persisted directory: ${state.entityCount || entities.length} entities, ${arr(state.groups).length} groups, processed ${state.nextIndex || 0}/${entities.length}, reconciled=${!!state.reconciled}`);
  }
  const usage = { prompt:0, completion:0, total:0 };
  if (!state.complete) {
    const totalBatches = Math.ceil(entities.length / BATCH_SIZE);
    while (state.nextIndex < entities.length) {
      const batchStart = state.nextIndex;
      const batch = entities.slice(state.nextIndex, state.nextIndex + BATCH_SIZE);
      const batchNumber = Math.floor(batchStart / BATCH_SIZE) + 1;
      const existingGroups = state.groups.map((g) => ({ name:g.name, description:g.description }));
      console.log(`[lemap directory] clustering batch ${batchNumber}/${totalBatches}: entities ${batchStart + 1}-${batchStart + batch.length}, existing groups ${existingGroups.length}`);
      const call = await modelJson(client, model,
        'Build an evolving business directory over enterprise entities. Assign EVERY supplied entity to one or more semantically appropriate business groups. An entity may belong to multiple groups. Prefer reusing an existing group when its meaning fits. Create a new group only when no existing group is a good semantic home. Group names must be concise business concepts, not technical implementation labels. Do not infer physical fields or joins. Return {"assignments":[{"entity":"exact supplied entity name","groups":["existing or new group names"]}],"newGroups":[{"name":"","description":"one-line business scope"}]}.',
        { existingGroups, entities:batch });
      addUsage(usage, call.usage);
      applyBatch(state, batch, call.parsed);
      state.nextIndex += batch.length;
      state.updatedAt = new Date().toISOString();
      save(file, state);
      const created = arr(call.parsed?.newGroups).map((g) => text(g?.name, 100)).filter(Boolean);
      console.log(`[lemap directory] batch ${batchNumber}/${totalBatches} done: ${state.nextIndex}/${entities.length} entities, ${state.groups.length} groups${created.length ? `, new: ${created.slice(0, 8).join(', ')}` : ''}, tokens ${call.usage.total}`);
      log('entity_directory_batch', { from:state.nextIndex - batch.length, to:state.nextIndex, entityCount:entities.length, groupCount:state.groups.length, usage:call.usage, output:call.parsed });
    }
    state.complete = true;
    save(file, state);
    console.log(`[lemap directory] clustering complete: ${entities.length} entities assigned across ${state.groups.length} provisional groups`);
  }
  if (!state.reconciled && state.groups.length) {
    const groups = state.groups.map((g) => ({ name:g.name, description:g.description, representativeEntities:representatives(state, g.name) }));
    console.log(`[lemap directory] reconciling ${groups.length} provisional groups`);
    const call = await modelJson(client, model,
      'Reconcile an enterprise business directory created incrementally. Merge groups that mean the same thing and rename unclear groups to concise stable business concepts. Preserve genuinely distinct groups. Every source group must appear exactly once in sourceGroups of the returned canonical groups. Do not reclassify individual entities here. Return {"groups":[{"name":"canonical group name","description":"one-line business scope","sourceGroups":["exact source group names"]}]}.',
      { groups });
    addUsage(usage, call.usage);
    applyReconciliation(state, call.parsed);
    state.reconciled = true;
    state.updatedAt = new Date().toISOString();
    save(file, state);
    console.log(`[lemap directory] reconciliation complete: ${groups.length} provisional → ${state.groups.length} canonical groups, tokens ${call.usage.total}`);
    log('entity_directory_reconcile', { sourceGroupCount:groups.length, canonicalGroupCount:state.groups.length, usage:call.usage, output:call.parsed });
  }
  if (state.complete && state.reconciled && usage.total === 0) console.log(`[lemap directory] reuse ready: ${state.groups.length} canonical groups; no clustering calls needed`);
  console.log(`[lemap directory] ready: ${state.entityCount || entities.length} entities, ${state.groups.length} groups, build tokens ${usage.total}`);
  return { directory:state, file, usage, reused:usage.total === 0 };
}

export async function parseQueryIntent({ client, model, question, directory, log = () => {} }) {
  const groups = arr(directory?.groups).map((g) => ({ name:g.name, description:g.description }));
  console.log(`[lemap intent] parsing question against ${groups.length} directory groups: ${question}`);
  const call = await modelJson(client, model,
    'Parse the business question into a stable logical request BEFORE physical graph traversal. Requirements must be canonical business concepts, not database/entity/field names. Select only directory groups likely to help resolve those requirements. A requirement may later map to any physical field with equivalent meaning. Return {"intent":"data_analytics|web_analytics|operations|support|decision_support|engineering|other","requirements":[{"concept":"short canonical concept","role":"measure|dimension|time|filter|attribute|key","value":"optional requested value or empty"}],"relevantGroups":["exact directory group names"],"interpretation":"one concise sentence"}.',
    { question, groups });
  const valid = new Map(groups.map((g) => [key(g.name), g.name]));
  const relevantGroups = uniq(arr(call.parsed?.relevantGroups).map((g) => valid.get(key(g))).filter(Boolean)).slice(0, 10);
  const requirements = arr(call.parsed?.requirements).slice(0, 12).map((r) => ({ concept:text(r?.concept, 100), role:text(r?.role, 30), value:text(r?.value, 120) })).filter((r) => r.concept);
  const intent = { intent:text(call.parsed?.intent, 40) || 'data_analytics', requirements, relevantGroups, interpretation:text(call.parsed?.interpretation, 240) };
  const preferredEntities = uniq(Object.entries(directory?.assignments || {})
    .filter(([, memberships]) => arr(memberships).some((membership) => relevantGroups.some((g) => key(g) === key(membership))))
    .map(([entity]) => entity));
  const requirementText = requirements.map((r) => `${r.concept}${r.role ? ` [${r.role}]` : ''}${r.value ? `=${r.value}` : ''}`).join(', ');
  console.log(`[lemap intent] requirements: ${requirementText || '(none)'}`);
  console.log(`[lemap intent] groups: ${relevantGroups.join(', ') || '(none)'} → ${preferredEntities.length} candidate entities, tokens ${call.usage.total}`);
  log('query_intent_directory', { question, intent, preferredEntityCount:preferredEntities.length, usage:call.usage });
  return { intent, preferredEntities, usage:call.usage };
}
