const arr = (v) => Array.isArray(v) ? v : [];
const clean = (v, n = 180) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, n);
const key = (v) => String(v || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const uniq = (xs) => [...new Set(arr(xs).filter(Boolean).map(String))];

const MAX_EXPANSION_ROUNDS = 3;
const MAX_ENTITIES = 32;
const MAX_WORKFLOWS = 20;
const MAX_FIELDS_PER_ENTITY = 18;
const MAX_NEIGHBOURS_PER_NODE = 12;

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

function questionTerms(question) {
  const q = String(question || '').toLowerCase();
  const terms = new Set(q.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  if (/sell|sales|sold|revenue/.test(q)) ['order', 'item', 'quantity', 'amount', 'total', 'price'].forEach((x) => terms.add(x));
  if (/region|location|geograph|state|country/.test(q)) ['region', 'state', 'country', 'geo', 'address', 'postal', 'contact'].forEach((x) => terms.add(x));
  if (/product|item/.test(q)) ['product', 'item'].forEach((x) => terms.add(x));
  if (/customer|buyer/.test(q)) ['customer', 'party'].forEach((x) => terms.add(x));
  return [...terms];
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
      out.push({
        from, relation, to,
        description: clean(rel?.description, 140),
        workflowId: String(arc.id),
        workflowName: clean(arc.title, 100)
      });
    }
  }
  return out;
}

function fieldScore(field, question) {
  const hay = `${field?.physicalFieldName || field?.name || ''} ${field?.description || ''}`.toLowerCase();
  let score = field?.isPk ? 5 : 0;
  for (const term of questionTerms(question)) if (hay.includes(term)) score += 3;
  if (/orderid|productid|partyid|contactmechid|seqid|geoid/i.test(field?.physicalFieldName || field?.name || '')) score += 3;
  if (/quantity|amount|total|price|date|status|region|state|country|geo|address|postal/i.test(hay)) score += 2;
  return score;
}

function fieldsForEntity(name, arcs, question) {
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
          isPk: !!field?.isPk,
          score: fieldScore(field, question)
        });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_FIELDS_PER_ENTITY).map(({ score, ...field }) => field);
}

function workflowsForEntity(name, arcs) {
  const wanted = key(name), out = [];
  for (const arc of arcs) {
    const present = arr(arc.entityDetails).some((d) => key(d?.name) === wanted)
      || arr(arc.entities).some((e) => key(e) === wanted)
      || arr(arc.persistentObjects).some((e) => key(e) === wanted);
    if (present) out.push({
      id: String(arc.id),
      name: clean(arc.title, 110),
      description: clean(arc.businessIntent || arc.outcome, 140)
    });
  }
  return out;
}

function entitiesForWorkflow(workflowId, arcs) {
  const arc = arcs.find((a) => String(a.id) === String(workflowId));
  if (!arc) return [];
  const catalog = new Map(entityCatalog(arcs).map((e) => [key(e.name), e]));
  return uniq([
    ...arr(arc.entities),
    ...arr(arc.persistentObjects),
    ...arr(arc.entityDetails).map((d) => d?.name)
  ]).filter(friendlyName).map((name) => catalog.get(key(name)) || { name, description: '' });
}

function relatedWorkflows(workflowId, arcs) {
  const own = new Set(entitiesForWorkflow(workflowId, arcs).map((e) => key(e.name)));
  if (!own.size) return [];
  const out = [];
  for (const other of arcs) {
    if (String(other.id) === String(workflowId)) continue;
    const shared = entitiesForWorkflow(other.id, arcs).map((e) => e.name).filter((n) => own.has(key(n)));
    if (!shared.length) continue;
    out.push({
      id: String(other.id),
      name: clean(other.title, 110),
      description: clean(other.businessIntent || other.outcome, 140),
      sharedEntities: uniq(shared).slice(0, 8)
    });
  }
  return out;
}

function connectedEntities(name, arcs) {
  const wanted = key(name);
  const catalog = new Map(entityCatalog(arcs).map((e) => [key(e.name), e]));
  const out = new Map();
  for (const edge of relationEdges(arcs)) {
    if (key(edge.from) === wanted) {
      const entity = catalog.get(key(edge.to)) || { name: edge.to, description: '' };
      out.set(key(entity.name), entity);
    }
    if (key(edge.to) === wanted) {
      const entity = catalog.get(key(edge.from)) || { name: edge.from, description: '' };
      out.set(key(entity.name), entity);
    }
  }
  return [...out.values()].slice(0, MAX_NEIGHBOURS_PER_NODE);
}

function relationsForEntity(name, arcs) {
  const wanted = key(name);
  return relationEdges(arcs)
    .filter((edge) => key(edge.from) === wanted || key(edge.to) === wanted)
    .slice(0, MAX_NEIGHBOURS_PER_NODE);
}

function relationsForWorkflow(workflowId, arcs) {
  return relationEdges(arcs).filter((edge) => String(edge.workflowId) === String(workflowId)).slice(0, 20);
}

function entityDetail(name, arcs, question) {
  const catalog = new Map(entityCatalog(arcs).map((e) => [key(e.name), e]));
  const base = catalog.get(key(name)) || { name, description: '' };
  return {
    name: base.name,
    description: clean(base.description, 150),
    fields: fieldsForEntity(base.name, arcs, question),
    connectedEntities: connectedEntities(base.name, arcs).map((e) => ({ name: e.name, description: clean(e.description, 120) })),
    workflows: workflowsForEntity(base.name, arcs).slice(0, MAX_NEIGHBOURS_PER_NODE),
    relations: relationsForEntity(base.name, arcs).map((r) => ({
      from: r.from, relation: r.relation, to: r.to, description: clean(r.description, 120), workflowId: r.workflowId
    }))
  };
}

function workflowDetail(workflowId, arcs) {
  const arc = arcs.find((a) => String(a.id) === String(workflowId));
  if (!arc) return null;
  return {
    id: String(arc.id),
    name: clean(arc.title, 110),
    description: clean(arc.businessIntent || arc.businessOutcome || arc.outcome, 150),
    entities: entitiesForWorkflow(arc.id, arcs).slice(0, 16).map((e) => ({ name: e.name, description: clean(e.description, 120) })),
    relatedWorkflows: relatedWorkflows(arc.id, arcs).slice(0, MAX_NEIGHBOURS_PER_NODE),
    relations: relationsForWorkflow(arc.id, arcs).map((r) => ({ from: r.from, relation: r.relation, to: r.to, description: clean(r.description, 120) }))
  };
}

function createLocalMap() {
  return { entities: new Map(), workflows: new Map(), connections: new Map(), expandedEntities: new Set(), expandedWorkflows: new Set() };
}

function rememberConnection(local, relation) {
  const k = `${key(relation.from)}|${key(relation.relation)}|${key(relation.to)}`;
  if (!local.connections.has(k)) local.connections.set(k, relation);
}

function mergeEntity(local, detail) {
  if (!detail?.name || local.entities.size >= MAX_ENTITIES && !local.entities.has(key(detail.name))) return;
  local.entities.set(key(detail.name), detail);
  for (const relation of arr(detail.relations)) rememberConnection(local, relation);
}

function mergeWorkflow(local, detail) {
  if (!detail?.id || local.workflows.size >= MAX_WORKFLOWS && !local.workflows.has(String(detail.id))) return;
  local.workflows.set(String(detail.id), detail);
  for (const relation of arr(detail.relations)) rememberConnection(local, relation);
}

function expandNodes(local, { entities = [], workflowIds = [] }, arcs, question) {
  const requestedEntities = uniq(arr(entities).filter(friendlyName));
  const requestedWorkflows = uniq(arr(workflowIds).map(String));
  const neighbourEntityNames = new Set();
  const neighbourWorkflowIds = new Set();

  for (const name of requestedEntities) {
    local.expandedEntities.add(key(name));
    const detail = entityDetail(name, arcs, question);
    mergeEntity(local, detail);
    for (const entity of arr(detail.connectedEntities)) neighbourEntityNames.add(entity.name);
    for (const workflow of arr(detail.workflows)) neighbourWorkflowIds.add(String(workflow.id));
  }

  for (const id of requestedWorkflows) {
    local.expandedWorkflows.add(String(id));
    const detail = workflowDetail(id, arcs);
    if (!detail) continue;
    mergeWorkflow(local, detail);
    for (const entity of arr(detail.entities)) neighbourEntityNames.add(entity.name);
    for (const workflow of arr(detail.relatedWorkflows)) neighbourWorkflowIds.add(String(workflow.id));
  }

  // Immediate neighbours are returned as useful nodes, not bare names.
  for (const name of [...neighbourEntityNames].slice(0, MAX_NEIGHBOURS_PER_NODE * 2)) {
    if (local.entities.size >= MAX_ENTITIES && !local.entities.has(key(name))) break;
    mergeEntity(local, entityDetail(name, arcs, question));
  }
  for (const id of [...neighbourWorkflowIds].slice(0, MAX_NEIGHBOURS_PER_NODE * 2)) {
    if (local.workflows.size >= MAX_WORKFLOWS && !local.workflows.has(String(id))) break;
    mergeWorkflow(local, workflowDetail(id, arcs));
  }
}

function serializeLocalMap(local) {
  return {
    entities: [...local.entities.values()].map((entity) => ({
      name: entity.name,
      description: clean(entity.description, 120),
      fields: arr(entity.fields).map((f) => ({ field: f.field, type: f.type, description: clean(f.description, 90), isPk: f.isPk })),
      connectedEntities: arr(entity.connectedEntities).slice(0, MAX_NEIGHBOURS_PER_NODE),
      workflows: arr(entity.workflows).slice(0, MAX_NEIGHBOURS_PER_NODE).map((w) => ({ id: w.id, name: w.name, description: clean(w.description, 100) })),
      relations: arr(entity.relations).slice(0, MAX_NEIGHBOURS_PER_NODE).map((r) => ({ from: r.from, relation: r.relation, to: r.to }))
    })),
    workflows: [...local.workflows.values()].map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      description: clean(workflow.description, 120),
      entities: arr(workflow.entities).slice(0, 16),
      relatedWorkflows: arr(workflow.relatedWorkflows).slice(0, MAX_NEIGHBOURS_PER_NODE),
      relations: arr(workflow.relations).slice(0, 16).map((r) => ({ from: r.from, relation: r.relation, to: r.to }))
    })),
    connections: [...local.connections.values()].slice(0, 60).map((r) => ({ from: r.from, relation: r.relation, to: r.to }))
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

function normalizeExpansionRequest(response, local) {
  const availableEntityNames = new Map([...local.entities.values()].map((e) => [key(e.name), e.name]));
  const availableWorkflowIds = new Set([...local.workflows.keys()]);
  return {
    entities: uniq(arr(response?.expandEntities).map((n) => availableEntityNames.get(key(n))).filter(Boolean))
      .filter((name) => !local.expandedEntities.has(key(name))).slice(0, 4),
    workflowIds: uniq(arr(response?.expandWorkflowIds).map(String).filter((id) => availableWorkflowIds.has(id)))
      .filter((id) => !local.expandedWorkflows.has(id)).slice(0, 4)
  };
}

const ANSWER_SYSTEM = `Answer the user's question ONLY from the accumulated local semantic map. For analytics, the expected answer is a DATA VIEW: exact entities, exact fields, and how those entities connect so the fields can form one combined view.
Return JSON in one of two forms.
If more graph context is genuinely needed and expansion rounds remain:
{"status":"incomplete","missing":["short missing concept"],"expandEntities":["CURRENT entity name"],"expandWorkflowIds":["CURRENT workflow id"]}
Choose expansion nodes ONLY from nodes already present in the supplied local map, based on their fields/descriptions/relations. Do not guess unseen nodes.
If you can answer, or no useful expansion remains:
{"status":"complete","intent":"","answer":"2-4 concise sentences","dataView":{"grain":"","select":[{"entity":"","field":"","alias":"","role":"key|measure|dimension|time|attribute"}],"joins":[{"left":"Entity.field or Entity","right":"Entity.field or Entity","relation":"","evidenced":true}],"filters":[],"groupBy":[],"orderBy":[],"missing":[]},"nextStep":""}.
Rules: use only supplied entity/field names; never substitute a semantically different field for a requested concept; exact field joins must be supported by the map, otherwise use an entity-level connection with evidenced=false; put unresolved fields/joins in dataView.missing; never expose source paths, framework classes, service names, or implementation details.`;

export async function investigateQuery({ question, client, model, arcs, snapshot, mapStateForArc, pathHints = () => [], log = () => {} }) {
  const usage = { prompt: 0, completion: 0, total: 0 };
  const workflows = workflowCatalog(arcs, mapStateForArc, snapshot);
  const entities = entityCatalog(arcs);

  const selected = await jsonCall(
    client,
    model,
    `Given a business question and a top-level semantic catalog, select only the relevant starting points. The catalog contains ALL entity names/descriptions and workflow names/descriptions, but no detailed fields yet. Return JSON only: {"intent":"data_analytics|web_analytics|operations|support|decision_support|engineering|other","workflowIds":[],"entities":[]}. Use only supplied workflow IDs/entity names. Select at most 5 workflows and 6 entities. Do not answer the question yet.`,
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
    const recovered = lexicalFallback(question, workflows, entities);
    selection = { ...recovered, intent: selected.intent || recovered.intent };
    log('query_guided_recovery', { stage: 'select', reason: 'empty_selection', recovered: selection });
  }

  const local = createLocalMap();
  expandNodes(local, selection, arcs, question);

  let response = null;
  let expansionRounds = 0;
  for (let round = 0; round <= MAX_EXPANSION_ROUNDS; round += 1) {
    const canExpand = round < MAX_EXPANSION_ROUNDS;
    const localMap = serializeLocalMap(local);
    response = await jsonCall(
      client,
      model,
      ANSWER_SYSTEM,
      {
        question,
        intent: selection.intent,
        expansionRound: round,
        expansionRoundsRemaining: MAX_EXPANSION_ROUNDS - round,
        localMap,
        unlearnedHints: pathHints(question).slice(0, 2)
      },
      round === 0 ? 'answer_or_expand_0' : `answer_or_expand_${round}`,
      usage,
      log
    );

    if (response?.status !== 'incomplete' || !canExpand) break;
    const request = normalizeExpansionRequest(response, local);
    if (!request.entities.length && !request.workflowIds.length) {
      log('query_guided_stop', { reason: 'model_requested_no_expandable_current_nodes', round, response });
      break;
    }
    expansionRounds += 1;
    log('query_guided_expand', { round: expansionRounds, request, missing: arr(response.missing).slice(0, 6) });
    expandNodes(local, request, arcs, question);
  }

  // If the last model response was incomplete because the cap was reached, ask once for a forced final answer.
  if (response?.status === 'incomplete') {
    response = await jsonCall(
      client,
      model,
      `${ANSWER_SYSTEM}\nExpansion is now closed. You MUST return status=complete using the available map and list every unresolved requirement under dataView.missing.`,
      {
        question,
        intent: selection.intent,
        expansionRound: expansionRounds,
        expansionRoundsRemaining: 0,
        localMap: serializeLocalMap(local),
        unresolvedFromPreviousRound: arr(response.missing).slice(0, 8)
      },
      'forced_final_answer', usage, log
    );
  }

  return {
    ...response,
    investigation: {
      mode: 'select-expand-bounded',
      thinking: 'disabled',
      maxExpansionRounds: MAX_EXPANSION_ROUNDS,
      expansionRounds,
      selectedWorkflowIds: selection.workflowIds,
      selectedEntities: selection.entities,
      accumulatedEntityCount: local.entities.size,
      accumulatedWorkflowCount: local.workflows.size,
      usage
    }
  };
}
