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
function parseJson(text) { try { return JSON.parse(text || '{}'); } catch { return {}; } }
function friendlyName(name) {
  const v = clean(name, 100);
  return !!v && !/[.#/:()]/.test(v) && !/\b(service|services|record|records|result|results|output|retrieved|read\/updated)\b/i.test(v);
}

function workflowCatalog(arcs, mapStateForArc, snapshot) {
  return arcs.map((arc) => ({
    id: String(arc.id),
    name: clean(arc.title, 110),
    description: clean(arc.businessIntent || arc.businessOutcome || arc.outcome || arc.nature, 150),
    state: mapStateForArc(arc, snapshot)
  }));
}

function entityCatalog(arcs) {
  const by = new Map();
  for (const arc of arcs) {
    for (const detail of arr(arc.entityDetails)) {
      const name = clean(detail?.name, 100);
      if (!friendlyName(name)) continue;
      const k = key(name);
      const current = by.get(k) || { name, description: '' };
      if (!current.description && detail?.description) current.description = clean(detail.description, 150);
      by.set(k, current);
    }
    for (const raw of [...arr(arc.entities), ...arr(arc.persistentObjects)]) {
      const name = clean(raw, 100);
      if (!friendlyName(name)) continue;
      if (!by.has(key(name))) by.set(key(name), { name, description: '' });
    }
  }
  return [...by.values()];
}

function relationEdges(arcs) {
  const seen = new Set();
  const out = [];
  for (const arc of arcs) {
    for (const rel of arr(arc.relationshipDetails)) {
      const from = clean(rel?.from, 100), to = clean(rel?.to, 100), relation = clean(rel?.relation, 100);
      if (!friendlyName(from) || !friendlyName(to)) continue;
      const k = `${key(from)}|${key(relation)}|${key(to)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ from, relation, to, workflowId: String(arc.id), workflowName: clean(arc.title, 100) });
    }
  }
  return out;
}

function fieldsForEntity(name, arcs) {
  const wanted = key(name), seen = new Set(), out = [];
  for (const arc of arcs) {
    for (const detail of arr(arc.entityDetails)) {
      if (key(detail?.name) !== wanted) continue;
      for (const field of arr(detail?.fields)) {
        const fieldName = clean(field?.physicalFieldName || field?.name, 100);
        if (!fieldName) continue;
        const sourceEntity = clean(field?.sourceEntity || detail?.name || name, 100);
        const k = `${key(sourceEntity)}|${key(fieldName)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({
          entity: sourceEntity,
          field: fieldName,
          type: clean(field?.type, 50),
          description: clean(field?.description, 120),
          isPk: !!field?.isPk
        });
      }
    }
  }
  return out;
}

function workflowsForEntity(name, arcs) {
  const wanted = key(name), out = [];
  for (const arc of arcs) {
    const present = arr(arc.entityDetails).some((d) => key(d?.name) === wanted)
      || arr(arc.entities).some((e) => key(e) === wanted)
      || arr(arc.persistentObjects).some((e) => key(e) === wanted);
    if (present) out.push({ id: String(arc.id), name: clean(arc.title, 110), description: clean(arc.businessIntent || arc.outcome, 140) });
  }
  return out;
}

function entitiesForWorkflow(workflowId, arcs) {
  const arc = arcs.find((a) => String(a.id) === String(workflowId));
  if (!arc) return [];
  return uniq([
    ...arr(arc.entities),
    ...arr(arc.persistentObjects),
    ...arr(arc.entityDetails).map((d) => d?.name)
  ]).filter(friendlyName).map((name) => ({ name }));
}

function relatedWorkflows(workflowId, arcs) {
  const arc = arcs.find((a) => String(a.id) === String(workflowId));
  if (!arc) return [];
  const own = new Set(entitiesForWorkflow(workflowId, arcs).map((e) => key(e.name)));
  if (!own.size) return [];
  const out = [];
  for (const other of arcs) {
    if (String(other.id) === String(workflowId)) continue;
    const shared = entitiesForWorkflow(other.id, arcs).map((e) => e.name).filter((n) => own.has(key(n)));
    if (!shared.length) continue;
    out.push({ id: String(other.id), name: clean(other.title, 110), description: clean(other.businessIntent || other.outcome, 140), sharedEntities: uniq(shared).slice(0, 8) });
  }
  return out;
}

function oneHopExpand(selection, arcs) {
  const edges = relationEdges(arcs);
  const selectedEntityNames = uniq(arr(selection?.entities).filter(friendlyName));
  const selectedWorkflowIds = uniq(arr(selection?.workflowIds).map(String));
  const entityNames = new Set(selectedEntityNames.map(key));
  const workflowIds = new Set(selectedWorkflowIds);

  for (const id of selectedWorkflowIds) {
    for (const entity of entitiesForWorkflow(id, arcs)) entityNames.add(key(entity.name));
    for (const wf of relatedWorkflows(id, arcs)) workflowIds.add(String(wf.id));
  }
  for (const name of selectedEntityNames) {
    for (const edge of edges) {
      if (key(edge.from) === key(name)) entityNames.add(key(edge.to));
      if (key(edge.to) === key(name)) entityNames.add(key(edge.from));
    }
    for (const wf of workflowsForEntity(name, arcs)) workflowIds.add(String(wf.id));
  }

  const entityCatalogByKey = new Map(entityCatalog(arcs).map((e) => [key(e.name), e]));
  const entities = [...entityNames]
    .map((k) => entityCatalogByKey.get(k))
    .filter(Boolean)
    .slice(0, 24)
    .map((entity) => ({ ...entity, fields: fieldsForEntity(entity.name, arcs).slice(0, 24) }));

  const entityKeySet = new Set(entities.map((e) => key(e.name)));
  const workflows = [...workflowIds]
    .map((id) => arcs.find((a) => String(a.id) === String(id)))
    .filter(Boolean)
    .slice(0, 16)
    .map((arc) => ({
      id: String(arc.id),
      name: clean(arc.title, 110),
      description: clean(arc.businessIntent || arc.outcome, 150),
      entities: entitiesForWorkflow(arc.id, arcs).map((e) => e.name).filter((n) => entityKeySet.has(key(n))).slice(0, 16)
    }));

  const connections = edges
    .filter((edge) => entityKeySet.has(key(edge.from)) && entityKeySet.has(key(edge.to)))
    .slice(0, 40);

  return { entities, workflows, connections };
}

function compactExpandedMap(expanded) {
  return {
    entities: arr(expanded.entities).map((e) => ({
      name: e.name,
      description: clean(e.description, 100),
      fields: arr(e.fields).map((f) => ({ field: f.field, type: f.type, description: clean(f.description, 80), isPk: f.isPk })).slice(0, 16)
    })),
    workflows: arr(expanded.workflows).map((w) => ({ id: w.id, name: w.name, description: clean(w.description, 100), entities: w.entities })),
    connections: arr(expanded.connections).map((c) => ({ from: c.from, relation: c.relation, to: c.to }))
  };
}

function lexicalFallback(question, workflows, entities) {
  const words = String(question || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const score = (text) => words.reduce((s, w) => s + (String(text || '').toLowerCase().includes(w) ? 1 : 0), 0);
  return {
    intent: /sales|sell|sold|highest|lowest|region|product|trend|group|rank/.test(String(question).toLowerCase()) ? 'data_analytics' : 'other',
    workflowIds: workflows.map((w) => ({ id: w.id, s: score(`${w.name} ${w.description}`) })).filter((x) => x.s > 0).sort((a,b) => b.s-a.s).slice(0,4).map((x) => x.id),
    entities: entities.map((e) => ({ name: e.name, s: score(`${e.name} ${e.description}`) })).filter((x) => x.s > 0).sort((a,b) => b.s-a.s).slice(0,6).map((x) => x.name)
  };
}

async function jsonCall(client, model, system, payload, stage, usage, log) {
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }],
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    temperature: 0
  });
  const u = usageOf(completion.usage || {}); addUsage(usage, u);
  const message = completion.choices?.[0]?.message || {};
  const raw = message.content || '';
  const parsed = parseJson(raw);
  log('query_guided_stage', {
    stage, model, input: payload, output: parsed, rawOutput: raw,
    reasoningOutput: clean(message.reasoning_content || '', 4000),
    finishReason: completion.choices?.[0]?.finish_reason || '', usage: u
  });
  return parsed;
}

export async function investigateQuery({ question, client, model, arcs, snapshot, mapStateForArc, pathHints = () => [], log = () => {} }) {
  const usage = { prompt: 0, completion: 0, total: 0 };
  const workflows = workflowCatalog(arcs, mapStateForArc, snapshot);
  const entities = entityCatalog(arcs);

  const selected = await jsonCall(
    client,
    model,
    `Given a business question and a top-level semantic catalog, select only the relevant items. Return JSON only: {"intent":"data_analytics|web_analytics|operations|support|decision_support|engineering|other","workflowIds":[],"entities":[]}. Use only supplied workflow IDs/entity names. Select at most 5 workflows and 6 entities. Do not answer the question yet.`,
    { question, workflows, entities },
    'select', usage, log
  );

  const validWorkflowIds = new Set(workflows.map((w) => String(w.id)));
  const validEntityNames = new Map(entities.map((e) => [key(e.name), e.name]));
  let selection = {
    intent: selected.intent || '',
    workflowIds: uniq(arr(selected.workflowIds).map(String).filter((id) => validWorkflowIds.has(id))).slice(0, 5),
    entities: uniq(arr(selected.entities).map((n) => validEntityNames.get(key(n))).filter(Boolean)).slice(0, 6)
  };
  if (!selection.workflowIds.length && !selection.entities.length) {
    selection = { ...lexicalFallback(question, workflows, entities), intent: selected.intent || lexicalFallback(question, workflows, entities).intent };
    log('query_guided_recovery', { stage: 'select', reason: 'empty_selection', recovered: selection });
  }

  const expanded = oneHopExpand(selection, arcs);
  const localMap = compactExpandedMap(expanded);

  const answer = await jsonCall(
    client,
    model,
    `Answer the user's question ONLY from the locally expanded semantic map. The expected answer is a DATA VIEW, not an investigation narrative. Return JSON exactly in this shape:
{"intent":"","answer":"2-4 concise sentences","dataView":{"grain":"","select":[{"entity":"","field":"","alias":"","role":"key|measure|dimension|time|attribute"}],"joins":[{"left":"Entity.field or Entity","right":"Entity.field or Entity","relation":"","evidenced":true}],"filters":[],"groupBy":[],"orderBy":[],"missing":[]},"nextStep":""}.
Rules: (1) select only fields that exist in the supplied entities; (2) show only entities/fields needed to answer the question; (3) explain how those entities connect; (4) use exact field-to-field joins only when the supplied map supports them; otherwise show the entity-level connection and set evidenced=false; (5) for analytics, include the fact grain, measures, dimensions, filters/grouping/order needed to build one combined data view; (6) if the map lacks a required field or join, put that exact gap in dataView.missing instead of inventing it; (7) never expose source paths, framework classes, service names, or implementation details.`,
    { question, intent: selection.intent, selected: selection, localMap, unlearnedHints: pathHints(question).slice(0, 2) },
    'answer', usage, log
  );

  return {
    ...answer,
    investigation: {
      mode: 'select-expand-answer',
      stages: 2,
      thinking: 'disabled',
      selectedWorkflowIds: selection.workflowIds,
      selectedEntities: selection.entities,
      expandedEntityCount: expanded.entities.length,
      expandedWorkflowCount: expanded.workflows.length,
      usage
    }
  };
}
