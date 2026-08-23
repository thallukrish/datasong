import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BATCH_SIZE = 50;
const NAME_MATCH_THRESHOLD = 0.5;
const MAX_NAME_AFFINITIES = 8;
const MAX_TFIDF_TERMS = 5;
const MAX_GROUP_MEMBERS_IN_PROMPT = 6;
const arr = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 240) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];
const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','by','can','for','from','has','have','in','is','it','its','of','on','or','that','the','their','this','to','used','using','was','were','which','with',
  'field','fields','entity','record','records','value','values','identifier','identifies','identification','description','type','types','code','codes','date','time'
]);

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
function tokenizeEntityName(value) {
  return String(value || '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}
function naturalWords(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}
function longestContiguousNameMatch(a, b) {
  const left = tokenizeEntityName(a), right = tokenizeEntityName(b);
  let best = { length:0, leftStart:-1, rightStart:-1, words:[] };
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      let length = 0;
      while (i + length < left.length && j + length < right.length && left[i + length] === right[j + length]) length += 1;
      if (!length) continue;
      const candidate = { length, leftStart:i, rightStart:j, words:left.slice(i, i + length) };
      const bestBoth = best.leftStart === 0 && best.rightStart === 0;
      const candidateBoth = i === 0 && j === 0;
      const bestEither = best.leftStart === 0 || best.rightStart === 0;
      const candidateEither = i === 0 || j === 0;
      if (
        length > best.length ||
        (length === best.length && candidateBoth && !bestBoth) ||
        (length === best.length && candidateBoth === bestBoth && candidateEither && !bestEither) ||
        (length === best.length && candidateBoth === bestBoth && candidateEither === bestEither && i + j < best.leftStart + best.rightStart)
      ) best = candidate;
    }
  }
  const denominator = Math.max(left.length, right.length, 1);
  const shorter = Math.max(Math.min(left.length, right.length), 1);
  const coverage = best.length / denominator;
  return {
    matchedWords:best.words,
    matchedWordCount:best.length,
    coverage,
    shorterCoverage:best.length / shorter,
    leftStart:best.leftStart,
    rightStart:best.rightStart,
    startsBoth:firstWordBoth(best),
    startsEither:firstWordEither(best),
    qualifies:best.length > 0 && coverage >= NAME_MATCH_THRESHOLD
  };
}
function firstWordBoth(match) { return match.leftStart === 0 && match.rightStart === 0; }
function firstWordEither(match) { return match.leftStart === 0 || match.rightStart === 0; }
function compareAffinity(a, b) {
  return b.coverage - a.coverage
    || Number(b.startsBoth) - Number(a.startsBoth)
    || Number(b.startsEither) - Number(a.startsEither)
    || (a.leftStart + a.rightStart) - (b.leftStart + b.rightStart)
    || b.matchedWordCount - a.matchedWordCount
    || a.entity.localeCompare(b.entity);
}
function entityCatalog(arcs = []) {
  const out = new Map();
  for (const arc of arr(arcs)) {
    for (const detail of arr(arc?.entityDetails)) {
      const name = text(detail?.name, 120);
      if (!name) continue;
      const k = key(name);
      const current = out.get(k) || { name, description:'', fields:[] };
      const description = text(detail?.description, 320);
      if (!current.description && description) current.description = description;
      const seenFields = new Set(current.fields.map((field) => key(field.name)));
      for (const field of arr(detail?.fields)) {
        const fieldName = text(field?.physicalFieldName || field?.name, 120);
        if (!fieldName || seenFields.has(key(fieldName))) continue;
        seenFields.add(key(fieldName));
        current.fields.push({ name:fieldName, description:text(field?.description, 360), type:text(field?.type, 80) });
      }
      out.set(k, current);
    }
    for (const name0 of [...arr(arc?.entities), ...arr(arc?.persistentObjects)]) {
      const name = text(name0, 120);
      if (name && !out.has(key(name))) out.set(key(name), { name, description:'', fields:[] });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function directoryFile(dataRoot, repoUrl) {
  const id = crypto.createHash('sha1').update(String(repoUrl || 'default')).digest('hex').slice(0, 16);
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
function tfidfHints(entities) {
  const docs = new Map();
  const df = new Map();
  for (const entity of entities) {
    const counts = new Map(), evidence = new Map();
    for (const field of arr(entity.fields)) {
      const description = text(field.description, 360);
      if (!description) continue;
      for (const word of naturalWords(description)) {
        counts.set(word, (counts.get(word) || 0) + 1);
        if (!evidence.has(word)) evidence.set(word, { field:field.name, description });
      }
    }
    docs.set(entity.name, { counts, evidence });
    for (const word of counts.keys()) df.set(word, (df.get(word) || 0) + 1);
  }
  const n = Math.max(entities.length, 1), result = new Map();
  for (const entity of entities) {
    const doc = docs.get(entity.name), scored = [];
    const total = [...doc.counts.values()].reduce((sum, count) => sum + count, 0) || 1;
    for (const [word, count] of doc.counts) {
      const tf = count / total;
      const idf = Math.log((n + 1) / ((df.get(word) || 0) + 1)) + 1;
      const evidence = doc.evidence.get(word) || {};
      scored.push({ term:word, score:Number((tf * idf).toFixed(4)), field:evidence.field || '', evidence:evidence.description || '' });
    }
    scored.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
    result.set(entity.name, scored.slice(0, MAX_TFIDF_TERMS));
  }
  return result;
}
function nameAffinityIndex(entities) {
  const result = new Map(entities.map((entity) => [entity.name, []]));
  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const match = longestContiguousNameMatch(entities[i].name, entities[j].name);
      if (!match.qualifies) continue;
      const left = { entity:entities[j].name, ...match };
      const right = { entity:entities[i].name, ...match, leftStart:match.rightStart, rightStart:match.leftStart };
      result.get(entities[i].name).push(left);
      result.get(entities[j].name).push(right);
    }
  }
  for (const list of result.values()) list.sort(compareAffinity);
  return result;
}
function clusteredEntitySet(state) {
  const names = new Set();
  for (const group of arr(state?.groups)) for (const member of arr(group?.members)) if (member?.entity) names.add(key(member.entity));
  return names;
}
function ensureGroup(state, name, description = '') {
  const clean = text(name, 100);
  if (!clean) return null;
  let group = arr(state.groups).find((item) => key(item.name) === key(clean));
  if (!group) {
    group = { name:clean, description:text(description, 260), members:[] };
    state.groups.push(group);
  } else if (!group.description && description) group.description = text(description, 260);
  return group;
}
function upsertMember(group, entity, affinity, reason) {
  const cleanEntity = text(entity, 120);
  if (!cleanEntity) return;
  const score = Math.max(0, Math.min(1, Number(affinity || 0)));
  let member = arr(group.members).find((item) => key(item.entity) === key(cleanEntity));
  if (!member) {
    member = { entity:cleanEntity, affinity:score, reason:text(reason, 320) };
    group.members.push(member);
  } else if (score >= Number(member.affinity || 0)) {
    member.affinity = score;
    if (reason) member.reason = text(reason, 320);
  }
}
function groupDirectoryForPrompt(state) {
  return arr(state.groups).map((group) => ({
    name:group.name,
    description:group.description,
    representativeMembers:arr(group.members)
      .slice().sort((a, b) => Number(b.affinity || 0) - Number(a.affinity || 0))
      .slice(0, MAX_GROUP_MEMBERS_IN_PROMPT)
      .map((member) => member.entity)
  }));
}
function entityPayload(entity, tfidf, affinities) {
  return {
    name:entity.name,
    description:entity.description,
    semanticHints:arr(tfidf.get(entity.name)),
    nameAffinity:arr(affinities.get(entity.name)).slice(0, MAX_NAME_AFFINITIES).map((item) => ({
      entity:item.entity,
      coverage:Number(item.coverage.toFixed(3)),
      matchedWords:item.matchedWords,
      startsBoth:item.startsBoth,
      startsEither:item.startsEither,
      startPositions:[item.leftStart, item.rightStart]
    }))
  };
}
function buildAffinityBatch(unclustered, affinities, limit = BATCH_SIZE) {
  const remaining = new Map(unclustered.map((entity) => [key(entity.name), entity]));
  const batch = [];
  while (remaining.size && batch.length < limit) {
    let anchor = null, bestDegree = -1;
    for (const entity of remaining.values()) {
      const degree = arr(affinities.get(entity.name)).filter((item) => remaining.has(key(item.entity))).length;
      if (degree > bestDegree || (degree === bestDegree && (!anchor || entity.name.localeCompare(anchor.name) < 0))) {
        anchor = entity; bestDegree = degree;
      }
    }
    if (!anchor) break;
    batch.push(anchor); remaining.delete(key(anchor.name));
    for (const match of arr(affinities.get(anchor.name))) {
      if (batch.length >= limit) break;
      const related = remaining.get(key(match.entity));
      if (!related) continue;
      batch.push(related); remaining.delete(key(related.name));
    }
  }
  return batch;
}
function applyMemberships(state, batch, result) {
  for (const group of arr(result?.newGroups)) ensureGroup(state, group?.name, group?.description);
  const validEntities = new Map(batch.map((entity) => [key(entity.name), entity.name]));
  const touched = new Set();
  for (const item of arr(result?.memberships)) {
    const entity = validEntities.get(key(item?.entity));
    if (!entity) continue;
    for (const membership of arr(item?.groups).slice(0, 5)) {
      const group = ensureGroup(state, membership?.name, membership?.description || '');
      if (!group) continue;
      upsertMember(group, entity, membership?.affinity, membership?.reason);
      touched.add(key(entity));
    }
  }
  return touched;
}
function directoryStats(state, entities) {
  const clustered = clusteredEntitySet(state);
  return {
    entityCount:entities.length,
    clusteredEntityCount:entities.filter((entity) => clustered.has(key(entity.name))).length,
    unclusteredEntityCount:entities.filter((entity) => !clustered.has(key(entity.name))).length,
    groupCount:arr(state?.groups).length
  };
}

export function loadEntityDirectory({ dataRoot, repoUrl = '' }) {
  const file = directoryFile(dataRoot, repoUrl);
  const directory = load(file);
  return { file, directory:directory?.version === 2 ? directory : null };
}

export async function ensureEntityDirectory({ client, model, arcs, dataRoot, repoUrl = '', commit = '', log = () => {} }) {
  const entities = entityCatalog(arcs);
  const file = directoryFile(dataRoot, repoUrl);
  let state = load(file);
  if (!state || state.version !== 2) {
    state = { version:2, repoUrl, lastCommit:commit, groups:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
    save(file, state);
    console.log(`[lemap directory] new v2 directory: ${entities.length} graph entities`);
  }
  state.repoUrl = repoUrl || state.repoUrl || '';
  state.lastCommit = commit || state.lastCommit || '';

  const initialStats = directoryStats(state, entities);
  console.log(`[lemap directory] graph check: ${initialStats.entityCount} entities, ${initialStats.clusteredEntityCount} clustered, ${initialStats.unclusteredEntityCount} unclustered, ${initialStats.groupCount} groups`);
  if (!initialStats.unclusteredEntityCount) {
    state.entityCount = initialStats.entityCount;
    state.clusteredEntityCount = initialStats.clusteredEntityCount;
    state.unclusteredEntityCount = 0;
    state.updatedAt = new Date().toISOString();
    save(file, state);
    return { directory:state, file, usage:{prompt:0,completion:0,total:0}, reused:true, ...initialStats };
  }
  if (!client) {
    console.log('[lemap directory] reasoning service unavailable; unclustered entities remain pending');
    return { directory:state, file, usage:{prompt:0,completion:0,total:0}, reused:true, ...initialStats };
  }

  console.log('[lemap directory] building deterministic name affinities and TF-IDF field-description hints');
  const affinities = nameAffinityIndex(entities);
  const tfidf = tfidfHints(entities);
  const usage = { prompt:0, completion:0, total:0 };
  let pass = 0;

  while (true) {
    const clustered = clusteredEntitySet(state);
    const unclustered = entities.filter((entity) => !clustered.has(key(entity.name)));
    if (!unclustered.length) break;
    const batch = buildAffinityBatch(unclustered, affinities, BATCH_SIZE);
    if (!batch.length) break;
    pass += 1;
    const existingGroups = groupDirectoryForPrompt(state);
    const payloadEntities = batch.map((entity) => entityPayload(entity, tfidf, affinities));
    const strongPairs = payloadEntities.reduce((sum, entity) => sum + entity.nameAffinity.length, 0);
    console.log(`[lemap directory] clustering pass ${pass}: ${batch.length} unclustered entities, ${existingGroups.length} existing groups, ${strongPairs} name-affinity hints`);

    const call = await modelJson(client, model,
      'Build or extend a business directory over enterprise entities. The supplied entities are currently UNCLUSTERED. Every supplied entity must receive at least one business-group membership. Existing groups are reusable options, not constraints: do NOT force an entity into an existing group merely to minimize group count. Create a new concise business group whenever the existing directory lacks the natural business concept. Entities may belong to multiple groups when they genuinely serve multiple business meanings. nameAffinity is deterministic lexical evidence: coverage is longest contiguous shared entity-name words divided by the longer entity-name word count; matches starting at the first word rank stronger, but later contiguous matches may still be meaningful. semanticHints are the top TF-IDF terms from field descriptions with their evidence sentence. Use entity description, semanticHints, nameAffinity, and existing representative members together. Return an affinity from 0 to 1 and a short concrete reason for every membership. Do not infer joins or query-specific meaning. Return {"memberships":[{"entity":"exact supplied entity name","groups":[{"name":"existing or new business group","affinity":0.0,"reason":"why this entity belongs here"}]}],"newGroups":[{"name":"new group","description":"one-line business scope"}]}.',
      { existingGroups, entities:payloadEntities });
    addUsage(usage, call.usage);
    const before = clusteredEntitySet(state).size;
    const touched = applyMemberships(state, batch, call.parsed);
    const after = clusteredEntitySet(state).size;
    state.entityCount = entities.length;
    state.clusteredEntityCount = entities.filter((entity) => clusteredEntitySet(state).has(key(entity.name))).length;
    state.unclusteredEntityCount = entities.length - state.clusteredEntityCount;
    state.updatedAt = new Date().toISOString();
    save(file, state);
    const created = arr(call.parsed?.newGroups).map((group) => text(group?.name, 100)).filter(Boolean);
    console.log(`[lemap directory] pass ${pass} done: +${after - before} clustered, ${state.clusteredEntityCount}/${entities.length}; ${state.groups.length} groups${created.length ? `; new: ${created.slice(0, 10).join(', ')}` : ''}; tokens ${call.usage.total}`);
    log('entity_directory_batch', { pass, batchEntities:batch.map((entity) => entity.name), touchedEntityCount:touched.size, groupCount:state.groups.length, usage:call.usage, output:call.parsed });
    if (after <= before) {
      console.log('[lemap directory] no clustering progress in this pass; stopping so unresolved entities can be retried on the next learning/startup cycle');
      break;
    }
  }

  const finalStats = directoryStats(state, entities);
  state.entityCount = finalStats.entityCount;
  state.clusteredEntityCount = finalStats.clusteredEntityCount;
  state.unclusteredEntityCount = finalStats.unclusteredEntityCount;
  state.updatedAt = new Date().toISOString();
  save(file, state);
  console.log(`[lemap directory] ready: ${finalStats.clusteredEntityCount}/${finalStats.entityCount} clustered, ${finalStats.groupCount} groups, ${finalStats.unclusteredEntityCount} pending, tokens ${usage.total}`);
  return { directory:state, file, usage, reused:usage.total === 0, ...finalStats };
}

export async function parseQueryIntent({ client, model, question, directory, log = () => {} }) {
  const groups = arr(directory?.groups).map((group) => ({ name:group.name, description:group.description }));
  console.log(`[lemap intent] parsing question against ${groups.length} directory groups: ${question}`);
  const call = await modelJson(client, model,
    'Parse the business question into a stable logical request BEFORE physical graph traversal. Requirements must be canonical business concepts, not database/entity/field names. Select only directory groups likely to help resolve those requirements. A requirement may later map to any physical field with equivalent meaning. Return {"intent":"data_analytics|web_analytics|operations|support|decision_support|engineering|other","requirements":[{"concept":"short canonical concept","role":"measure|dimension|time|filter|attribute|key","value":"optional requested value or empty"}],"relevantGroups":["exact directory group names"],"interpretation":"one concise sentence"}.',
    { question, groups });
  const valid = new Map(groups.map((group) => [key(group.name), group.name]));
  const relevantGroups = uniq(arr(call.parsed?.relevantGroups).map((group) => valid.get(key(group))).filter(Boolean)).slice(0, 10);
  const requirements = arr(call.parsed?.requirements).slice(0, 12).map((item) => ({ concept:text(item?.concept, 100), role:text(item?.role, 30), value:text(item?.value, 120) })).filter((item) => item.concept);
  const intent = { intent:text(call.parsed?.intent, 40) || 'data_analytics', requirements, relevantGroups, interpretation:text(call.parsed?.interpretation, 240) };
  const preferredEntities = uniq(arr(directory?.groups)
    .filter((group) => relevantGroups.some((selected) => key(selected) === key(group.name)))
    .flatMap((group) => arr(group.members).map((member) => member.entity)));
  const requirementText = requirements.map((item) => `${item.concept}${item.role ? ` [${item.role}]` : ''}${item.value ? `=${item.value}` : ''}`).join(', ');
  console.log(`[lemap intent] requirements: ${requirementText || '(none)'}`);
  console.log(`[lemap intent] groups: ${relevantGroups.join(', ') || '(none)'} → ${preferredEntities.length} candidate entities, tokens ${call.usage.total}`);
  log('query_intent_directory', { question, intent, preferredEntityCount:preferredEntities.length, usage:call.usage });
  return { intent, preferredEntities, usage:call.usage };
}
