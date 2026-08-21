const arr = (v) => Array.isArray(v) ? v : [];
const clean = (v, n = 180) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, n);
const key = (v) => String(v || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const uniq = (xs) => [...new Set(arr(xs).filter(Boolean).map(String))];

function usageOf(u = {}) {
  const prompt = Number(u.prompt_tokens || u.input_tokens || 0);
  const completion = Number(u.completion_tokens || u.output_tokens || 0);
  return { prompt, completion, total: Number(u.total_tokens || prompt + completion) };
}
function addUsage(total, u) { total.prompt += u.prompt; total.completion += u.completion; total.total += u.total; }
function parseJson(text, fallback = {}) { try { return JSON.parse(text || '{}'); } catch { return fallback; } }

function friendlyName(name) {
  const v = clean(name, 100);
  if (!v || /[.#/:()]/.test(v)) return false;
  if (/\b(service|services|record|records|result|results|output|retrieved|read\/updated)\b/i.test(v)) return false;
  return true;
}

function workflowCatalog(arcs, mapStateForArc, snapshot) {
  return arcs.map((arc) => ({
    id: arc.id,
    name: clean(arc.title, 110),
    description: clean(arc.businessIntent || arc.outcome || arc.businessOutcome || arc.nature, 150),
    state: mapStateForArc(arc, snapshot)
  })).slice(0, 40);
}

function entityCatalog(arcs) {
  const by = new Map();
  for (const arc of arcs) {
    for (const detail of arr(arc.entityDetails)) {
      const name = clean(detail?.name, 100); if (!friendlyName(name)) continue;
      const k = key(name); const cur = by.get(k) || { name, description: '', fieldCount: 0 };
      if (!cur.description && detail?.description) cur.description = clean(detail.description, 130);
      cur.fieldCount = Math.max(cur.fieldCount, arr(detail?.fields).length);
      by.set(k, cur);
    }
    for (const nameRaw of arr(arc.entities)) {
      const name = clean(nameRaw, 100); if (!friendlyName(name)) continue;
      const k = key(name); if (!by.has(k)) by.set(k, { name, description: '', fieldCount: 0 });
    }
  }
  return [...by.values()].slice(0, 80);
}

function fieldScore(field, query) {
  const q = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const hay = `${field?.name || ''} ${field?.description || ''}`.toLowerCase();
  let score = field?.isPk ? 2 : 0;
  for (const word of q) if (hay.includes(word)) score += 2;
  if (/orderid|partyid|productid|contactmechid|seqid/i.test(field?.name || '')) score += 2;
  if (/quantity|amount|total|price|date|status|region|state|country|geo/i.test(`${field?.name || ''} ${field?.description || ''}`)) score += 1;
  return score;
}

function fieldsForEntity(entityName, arcs, query, limit = 16) {
  const wanted = key(entityName); const by = new Map();
  for (const arc of arcs) for (const detail of arr(arc.entityDetails)) {
    if (key(detail?.name) !== wanted) continue;
    for (const f of arr(detail?.fields)) {
      const entity = clean(f?.sourceEntity || detail?.name || entityName, 100);
      const name = clean(f?.physicalFieldName || f?.name, 100);
      if (!name) continue;
      const fk = `${key(entity)}|${key(name)}`;
      if (!by.has(fk)) by.set(fk, { entity, name, type: clean(f?.type, 50), description: clean(f?.description, 120), isPk: !!f?.isPk, score: fieldScore(f, query) });
    }
  }
  return [...by.values()].sort((a,b) => b.score - a.score).slice(0, limit).map(({score, ...f}) => f);
}

function relationEdges(arcs) {
  const out = [];
  for (const arc of arcs) for (const r of arr(arc.relationshipDetails)) {
    const from = clean(r?.from, 100), to = clean(r?.to, 100);
    if (!friendlyName(from) || !friendlyName(to)) continue;
    out.push({ from, to, relation: clean(r?.relation, 100), description: clean(r?.description, 140), workflowId: arc.id, workflowName: clean(arc.title, 100) });
  }
  return out;
}

function entityDetail(name, arcs, question) {
  const wanted = key(name); let description = ''; const workflows = [];
  for (const arc of arcs) {
    const detail = arr(arc.entityDetails).find((d) => key(d?.name) === wanted);
    const present = detail || arr(arc.entities).some((e) => key(e) === wanted) || arr(arc.persistentObjects).some((e) => key(e) === wanted);
    if (!present) continue;
    if (!description && detail?.description) description = clean(detail.description, 150);
    workflows.push({ id: arc.id, name: clean(arc.title, 100), role: clean(detail?.description || arc.businessIntent || arc.outcome, 130) });
  }
  return { name, description, fields: fieldsForEntity(name, arcs, question), workflows: workflows.slice(0, 6) };
}

function selectedWorkflowDetail(ids, arcs) {
  const wanted = new Set(arr(ids).map(String));
  return arcs.filter((a) => wanted.has(String(a.id))).slice(0, 6).map((arc) => ({
    id: arc.id, name: clean(arc.title, 110), description: clean(arc.businessIntent || arc.outcome, 150),
    steps: arr(arc.workflowSteps).slice(0, 10).map((s) => ({ name: clean(s?.name, 100), description: clean(s?.description, 140), entities: uniq([...arr(s?.entities), ...arr(s?.persistentObjects)]).filter(friendlyName).slice(0, 8) })),
    relations: arr(arc.relationshipDetails).filter((r) => friendlyName(r?.from) && friendlyName(r?.to)).slice(0, 12).map((r) => ({ from:r.from, relation:r.relation, to:r.to, description:clean(r.description,120) }))
  }));
}

function nearbyEntities(selected, edges, limit = 8) {
  const wanted = new Set(arr(selected).map(key)); const out = [];
  for (const e of edges) {
    if (wanted.has(key(e.from)) && !wanted.has(key(e.to))) out.push(e.to);
    if (wanted.has(key(e.to)) && !wanted.has(key(e.from))) out.push(e.from);
  }
  return uniq(out).filter(friendlyName).slice(0, limit);
}

function sameNamedJoinFields(left, right) {
  const out = [];
  for (const lf of arr(left.fields)) for (const rf of arr(right.fields)) {
    if (!lf.name || !rf.name || key(lf.name) !== key(rf.name)) continue;
    if (!/id$|seqid$/i.test(lf.name)) continue;
    out.push({ left: `${left.name}.${lf.name}`, right: `${right.name}.${rf.name}`, basis: 'matching identifier fields', evidenced: true });
  }
  return out.slice(0, 4);
}

function findEntityPath(from, to, edges, maxDepth = 4) {
  const start = key(from), target = key(to); if (!start || !target) return null;
  const q = [{ name: from, path: [] }]; const seen = new Set([start]);
  while (q.length) {
    const cur = q.shift(); if (cur.path.length >= maxDepth) continue;
    for (const e of edges) {
      let next = null, edge = null;
      if (key(e.from) === key(cur.name)) { next = e.to; edge = e; }
      else if (key(e.to) === key(cur.name)) { next = e.from; edge = { ...e, from:e.to, to:e.from }; }
      if (!next || seen.has(key(next))) continue;
      const path = [...cur.path, edge];
      if (key(next) === target) return path;
      seen.add(key(next)); q.push({ name: next, path });
    }
  }
  return null;
}

function connectSelectedEntities(names, arcs, question) {
  const edges = relationEdges(arcs); const details = new Map(arr(names).map((n) => [key(n), entityDetail(n, arcs, question)])); const connections = [];
  for (let i=0;i<names.length;i+=1) for (let j=i+1;j<names.length;j+=1) {
    const a = names[i], b = names[j]; const da = details.get(key(a)), db = details.get(key(b));
    const fieldJoins = da && db ? sameNamedJoinFields(da, db) : [];
    const path = findEntityPath(a, b, edges);
    if (fieldJoins.length || path) connections.push({ from:a, to:b, fieldJoins, semanticPath:path || [] });
  }
  return connections.slice(0, 12);
}

async function jsonCall(client, model, system, payload, maxTokens, log, stage, usage) {
  const completion = await client.chat.completions.create({ model, messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(payload)}], response_format:{type:'json_object'}, temperature:0.1, max_tokens:maxTokens });
  const u = usageOf(completion.usage || {}); addUsage(usage, u);
  const raw = completion.choices?.[0]?.message?.content || '{}'; const parsed = parseJson(raw, {});
  log('query_guided_stage', { stage, input: payload, output: parsed, usage: u });
  return parsed;
}

export async function investigateQuery({ question, client, model, arcs, snapshot, mapStateForArc, pathHints = () => [], log = () => {} }) {
  const usage = { prompt:0, completion:0, total:0 };
  const workflows = workflowCatalog(arcs, mapStateForArc, snapshot);
  const entities = entityCatalog(arcs);

  const scope = await jsonCall(client, model,
    `Classify the question and select only the smallest relevant semantic area. You receive top-level learned workflows and entities only. Return JSON: {"intent":"data_analytics|web_analytics|operations|support|decision_support|engineering|other","workflowIds":[],"entities":[],"needs":[]}. Select max 5 workflows and 6 entities. For analytics, needs should name required fact/event, measures, dimensions, time/filter concepts. Do not invent names not supplied.`,
    { question, workflows, entities }, 420, log, 'scope', usage);

  const selectedWorkflowIds = arr(scope.workflowIds).map(String).slice(0,5);
  const selectedEntities = uniq(arr(scope.entities).filter((n) => entities.some((e) => key(e.name) === key(n)))).slice(0,6);
  const edges = relationEdges(arcs);
  const neighborhood = nearbyEntities(selectedEntities, edges, 8);
  const evidenceNames = uniq([...selectedEntities, ...neighborhood]).slice(0,10);
  const evidence = {
    question,
    intent: scope.intent || '',
    needs: arr(scope.needs).slice(0,8),
    workflows: selectedWorkflowDetail(selectedWorkflowIds, arcs),
    entities: evidenceNames.map((n) => entityDetail(n, arcs, question)),
    relations: edges.filter((e) => evidenceNames.some((n) => key(n) === key(e.from) || key(n) === key(e.to))).slice(0,20)
  };

  const plan = await jsonCall(client, model,
    `Using only this focused semantic evidence, choose the exact entities and fields needed to answer the question. Return JSON: {"grain":"","entities":[],"fields":[{"entity":"","field":"","role":"key|measure|dimension|time|attribute"}],"connections":[{"from":"","to":""}],"missing":[]}. Use max 5 entities and 8 fields. Every entity/field must appear in supplied evidence. For analytics, include join keys when visible. Do not answer yet.`,
    evidence, 520, log, 'plan', usage);

  const plannedEntities = uniq(arr(plan.entities).filter((n) => evidenceNames.some((e) => key(e) === key(n)))).slice(0,5);
  const connections = connectSelectedEntities(plannedEntities, arcs, question);
  const plannedFields = arr(plan.fields).filter((f) => {
    const d = evidence.entities.find((e) => key(e.name) === key(f?.entity));
    return d && arr(d.fields).some((x) => key(x.name) === key(f?.field));
  }).slice(0,8);

  const packet = {
    question,
    intent: scope.intent || 'other',
    grain: clean(plan.grain, 140),
    fields: plannedFields,
    connections,
    missing: arr(plan.missing).slice(0,6),
    selectedEntities: plannedEntities,
    unlearnedHints: pathHints(question).slice(0,3).map((h) => ({ id:h.id || h.pathId, label:clean(h.workflowTitle || h.label,100) }))
  };

  const answer = await jsonCall(client, model,
    `Produce the concise user-facing answer from this validated packet only. Return JSON exactly: {"intent":"","answer":"2-4 concise sentences","dataView":null or {"grain":"","select":[{"entity":"","field":"","alias":"","role":"key|measure|dimension|time|attribute"}],"joins":[{"left":"","right":"","relation":"","evidenced":true}],"filters":[],"groupBy":[],"orderBy":[],"missing":[]},"nextStep":""}. For analytics, construct the smallest useful data view. Use only supplied fields. Use fieldJoins when present. A semantic path without exact fieldJoins may explain connectivity but must be marked evidenced=false at the field-join level. Do not expose service names or source paths.`,
    packet, 650, log, 'answer', usage);

  return {
    ...answer,
    investigation: {
      mode: 'guided',
      stages: 3,
      selectedWorkflowIds,
      selectedEntities: plannedEntities,
      usage
    }
  };
}
