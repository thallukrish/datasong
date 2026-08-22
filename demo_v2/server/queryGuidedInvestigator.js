const arr = (v) => Array.isArray(v) ? v : [];
const clean = (v, n = 180) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, n);
const key = (v) => String(v || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const uniq = (xs) => [...new Set(arr(xs).filter(Boolean).map(String))];

const MAX_EXPANSION_ROUNDS = 3;
const MAX_EXPANDED_ENTITIES = 20;
const MAX_EXPANDED_WORKFLOWS = 12;
const MAX_FRONTIER_ENTITIES = 28;
const MAX_FRONTIER_WORKFLOWS = 18;
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
  const seen = new Set(), out = [];
  for (const arc of arcs) for (const rel of arr(arc.relationshipDetails)) {
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
  for (const arc of arcs) for (const detail of arr(arc.entityDetails)) {
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
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_FIELDS_PER_ENTITY).map(({ score, ...field }) => field);
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
  const catalog = new Map(entityCatalog(arcs).map((e) => [key(e.name), e]));
  return uniq([...arr(arc.entities), ...arr(arc.persistentObjects), ...arr(arc.entityDetails).map((d) => d?.name)])
    .filter(friendlyName)
    .map((name) => catalog.get(key(name)) || { name, description: '' });
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
  const wanted = key(name), catalog = new Map(entityCatalog(arcs).map((e) => [key(e.name), e])), out = new Map();
  for (const edge of relationEdges(arcs)) {
    if (key(edge.from) === wanted) {
      const entity = catalog.get(key(edge.to)) || { name: edge.to, description: '' };
      out.set(key(entity.name), { ...entity, via: edge });
    }
    if (key(edge.to) === wanted) {
      const entity = catalog.get(key(edge.from)) || { name: edge.from, description: '' };
      out.set(key(entity.name), { ...entity, via: edge });
    }
  }
  return [...out.values()].slice(0, MAX_NEIGHBOURS_PER_NODE);
}

function relationsForEntity(name, arcs) {
  const wanted = key(name);
  return relationEdges(arcs).filter((edge) => key(edge.from) === wanted || key(edge.to) === wanted).slice(0, MAX_NEIGHBOURS_PER_NODE);
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
    connectedEntities: connectedEntities(base.name, arcs).map((e) => ({ name: e.name, description: clean(e.description, 120), via: e.via })),
    workflows: workflowsForEntity(base.name, arcs).slice(0, MAX_NEIGHBOURS_PER_NODE),
    relations: relationsForEntity(base.name, arcs).map((r) => ({
      from: r.from, relation: r.relation, to: r.to, description: clean(r.description, 120), workflowId: r.workflowId, workflowName: r.workflowName
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
  return {
    expandedEntities: new Map(), expandedWorkflows: new Map(),
    frontierEntities: new Map(), frontierWorkflows: new Map(),
    connections: new Map(), trails: new Map()
  };
}

function trailKey(type, id) { return `${type}:${type === 'entity' ? key(id) : String(id)}`; }
function compactTrail(trail) { return arr(trail).slice(-8).map((x) => ({ type: x.type, name: clean(x.name, 100), description: clean(x.description, 120) })); }
function selectedTrail(type, name, description) {
  return [{ type, name, description: clean(description || 'Selected from the top-level semantic catalog.', 120) }];
}
function appendTrail(base, item) { return compactTrail([...arr(base), item]); }

function rememberConnection(local, relation) {
  const k = `${key(relation.from)}|${key(relation.relation)}|${key(relation.to)}`;
  if (!local.connections.has(k)) local.connections.set(k, relation);
}

function addFrontierEntity(local, entity, trail) {
  if (!entity?.name || local.expandedEntities.has(key(entity.name))) return;
  const k = key(entity.name);
  if (!local.frontierEntities.has(k) && local.frontierEntities.size < MAX_FRONTIER_ENTITIES) {
    local.frontierEntities.set(k, { name: entity.name, description: clean(entity.description, 120), state: 'unselected' });
    local.trails.set(trailKey('entity', entity.name), compactTrail(trail));
  }
}
function addFrontierWorkflow(local, workflow, trail) {
  if (!workflow?.id || local.expandedWorkflows.has(String(workflow.id))) return;
  const id = String(workflow.id);
  if (!local.frontierWorkflows.has(id) && local.frontierWorkflows.size < MAX_FRONTIER_WORKFLOWS) {
    local.frontierWorkflows.set(id, { id, name: workflow.name, description: clean(workflow.description, 120), state: 'unselected' });
    local.trails.set(trailKey('workflow', id), compactTrail(trail));
  }
}

function expandEntity(local, name, arcs, question, trail) {
  if (local.expandedEntities.size >= MAX_EXPANDED_ENTITIES && !local.expandedEntities.has(key(name))) return;
  const detail = entityDetail(name, arcs, question);
  if (!detail?.name) return;
  const k = key(detail.name);
  local.expandedEntities.set(k, detail);
  local.frontierEntities.delete(k);
  local.trails.set(trailKey('entity', detail.name), compactTrail(trail));
  for (const relation of arr(detail.relations)) rememberConnection(local, relation);

  for (const neighbour of arr(detail.connectedEntities)) {
    const relation = neighbour.via || {};
    const relationTrail = appendTrail(trail, {
      type: 'relation',
      name: `${relation.from || detail.name} ${relation.relation || 'relates to'} ${relation.to || neighbour.name}`,
      description: clean(relation.description, 120)
    });
    addFrontierEntity(local, neighbour, appendTrail(relationTrail, { type: 'entity', name: neighbour.name, description: neighbour.description }));
  }
  for (const workflow of arr(detail.workflows)) {
    addFrontierWorkflow(local, workflow, appendTrail(trail, { type: 'workflow', name: workflow.name, description: workflow.description }));
  }
}

function expandWorkflow(local, id, arcs, question, trail) {
  if (local.expandedWorkflows.size >= MAX_EXPANDED_WORKFLOWS && !local.expandedWorkflows.has(String(id))) return;
  const detail = workflowDetail(id, arcs);
  if (!detail) return;
  const workflowId = String(detail.id);
  local.expandedWorkflows.set(workflowId, detail);
  local.frontierWorkflows.delete(workflowId);
  local.trails.set(trailKey('workflow', workflowId), compactTrail(trail));
  for (const relation of arr(detail.relations)) rememberConnection(local, relation);

  for (const entity of arr(detail.entities)) {
    addFrontierEntity(local, entity, appendTrail(trail, { type: 'entity', name: entity.name, description: entity.description }));
  }
  for (const workflow of arr(detail.relatedWorkflows)) {
    addFrontierWorkflow(local, workflow, appendTrail(trail, { type: 'workflow', name: workflow.name, description: workflow.description }));
  }
}

function expandNodes(local, { entities = [], workflowIds = [] }, arcs, question, { initial = false } = {}) {
  for (const name of uniq(arr(entities).filter(friendlyName))) {
    const existingTrail = local.trails.get(trailKey('entity', name));
    const catalogItem = entityCatalog(arcs).find((e) => key(e.name) === key(name)) || { name, description: '' };
    expandEntity(local, name, arcs, question, existingTrail || selectedTrail('entity', catalogItem.name, initial ? catalogItem.description : 'Expanded from the current frontier.'));
  }
  for (const id of uniq(arr(workflowIds).map(String))) {
    const existingTrail = local.trails.get(trailKey('workflow', id));
    const arc = workflowCatalog(arcs, () => '', {}).find((w) => String(w.id) === String(id)) || { id, name: id, description: '' };
    expandWorkflow(local, id, arcs, question, existingTrail || selectedTrail('workflow', arc.name, initial ? arc.description : 'Expanded from the current frontier.'));
  }
}

function serializeLocalMap(local) {
  return {
    expandedEntities: [...local.expandedEntities.values()].map((entity) => ({
      name: entity.name,
      description: clean(entity.description, 120),
      trail: local.trails.get(trailKey('entity', entity.name)) || [],
      fields: arr(entity.fields).map((f) => ({ field: f.field, type: f.type, description: clean(f.description, 90), isPk: f.isPk })),
      connectedEntities: arr(entity.connectedEntities).map((e) => ({ name: e.name, description: clean(e.description, 90) })).slice(0, MAX_NEIGHBOURS_PER_NODE),
      workflows: arr(entity.workflows).map((w) => ({ id: w.id, name: w.name, description: clean(w.description, 90) })).slice(0, MAX_NEIGHBOURS_PER_NODE),
      relations: arr(entity.relations).map((r) => ({ from: r.from, relation: r.relation, to: r.to, description: clean(r.description, 80) })).slice(0, MAX_NEIGHBOURS_PER_NODE)
    })),
    expandedWorkflows: [...local.expandedWorkflows.values()].map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      description: clean(workflow.description, 120),
      trail: local.trails.get(trailKey('workflow', workflow.id)) || [],
      entities: arr(workflow.entities).slice(0, 16),
      relatedWorkflows: arr(workflow.relatedWorkflows).slice(0, MAX_NEIGHBOURS_PER_NODE),
      relations: arr(workflow.relations).slice(0, 16).map((r) => ({ from: r.from, relation: r.relation, to: r.to, description: clean(r.description, 80) }))
    })),
    unselectedEntities: [...local.frontierEntities.values()].map((entity) => ({
      ...entity,
      trail: local.trails.get(trailKey('entity', entity.name)) || []
    })),
    unselectedWorkflows: [...local.frontierWorkflows.values()].map((workflow) => ({
      ...workflow,
      trail: local.trails.get(trailKey('workflow', workflow.id)) || []
    })),
    connections: [...local.connections.values()].slice(0, 50).map((r) => ({ from: r.from, relation: r.relation, to: r.to, description: clean(r.description, 80) }))
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
  const message = completion.choices?.[0]?.message || {}, raw = message.content || '', parsed = parseJson(raw);
  log('query_guided_stage', {
    stage, model, input: payload, output: parsed, rawOutput: raw,
    reasoningOutput: clean(message.reasoning_content || '', 4000),
    finishReason: completion.choices?.[0]?.finish_reason || '', usage: u
  });
  return parsed;
}

function normalizeExpansionRequest(response, local) {
  const availableEntityNames = new Map([...local.frontierEntities.values()].map((e) => [key(e.name), e.name]));
  const availableWorkflowIds = new Set([...local.frontierWorkflows.keys()]);
  return {
    entities: uniq(arr(response?.expandEntities).map((n) => availableEntityNames.get(key(n))).filter(Boolean)).slice(0, 4),
    workflowIds: uniq(arr(response?.expandWorkflowIds).map(String).filter((id) => availableWorkflowIds.has(id))).slice(0, 4)
  };
}

const ANSWER_SYSTEM = `Answer the user's question ONLY from the current semantic exploration context. Expanded nodes contain full detail and a trail showing how they were reached. Unselected nodes are frontier candidates: they intentionally contain only name, description and trail until explicitly expanded.
For analytics, the expected final answer is a DATA VIEW: exact entities, exact fields, and how those fields connect into one combined view.
Return JSON in one of two forms.
If more context is genuinely needed and expansion rounds remain:
{"status":"incomplete","missing":["short missing concept"],"expandEntities":["UNSELECTED entity name"],"expandWorkflowIds":["UNSELECTED workflow id"]}
Choose expansion nodes ONLY from unselectedEntities/unselectedWorkflows, using their names, descriptions and trails. Do not guess unseen nodes.
If you can answer, or no useful expansion remains:
{"status":"complete","intent":"","answer":"2-4 concise sentences","dataView":{"grain":"","select":[{"entity":"","field":"","alias":"","role":"key|measure|dimension|time|attribute"}],"joins":[{"left":"Entity.field or Entity","right":"Entity.field or Entity","relation":"","evidenced":true}],"filters":[],"groupBy":[],"orderBy":[],"missing":[]},"nextStep":""}.
Rules: use only supplied entity/field names; never substitute a semantically different field for a requested concept; exact field joins must be supported by expanded evidence, otherwise use an entity-level connection with evidenced=false; put unresolved fields/joins in dataView.missing; never expose source paths, framework classes, service names, or implementation details.`;

export async function investigateQuery({ question, client, model, arcs, snapshot, mapStateForArc, pathHints = () => [], log = () => {} }) {
  const usage = { prompt: 0, completion: 0, total: 0 };
  const workflows = workflowCatalog(arcs, mapStateForArc, snapshot);
  const entities = entityCatalog(arcs);

  const selected = await jsonCall(
    client,
    model,
    `Given a business question and the COMPLETE top-level semantic catalog, select only relevant starting points. The catalog contains all entity names/descriptions and workflow names/descriptions, but no fields. Return JSON only: {"intent":"data_analytics|web_analytics|operations|support|decision_support|engineering|other","workflowIds":[],"entities":[]}. Use only supplied workflow IDs/entity names. Select at most 5 workflows and 6 entities. Do not answer yet.`,
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
  expandNodes(local, selection, arcs, question, { initial: true });

  let response = null, expansionRounds = 0;
  for (let round = 0; round <= MAX_EXPANSION_ROUNDS; round += 1) {
    const canExpand = round < MAX_EXPANSION_ROUNDS;
    response = await jsonCall(
      client,
      model,
      ANSWER_SYSTEM,
      {
        question,
        intent: selection.intent,
        expansionRound: round,
        expansionRoundsRemaining: MAX_EXPANSION_ROUNDS - round,
        context: serializeLocalMap(local),
        unlearnedHints: pathHints(question).slice(0, 2)
      },
      round === 0 ? 'answer_or_expand_0' : `answer_or_expand_${round}`,
      usage,
      log
    );

    if (response?.status !== 'incomplete' || !canExpand) break;
    const request = normalizeExpansionRequest(response, local);
    if (!request.entities.length && !request.workflowIds.length) {
      log('query_guided_stop', { reason: 'model_requested_no_unselected_frontier_nodes', round, response });
      break;
    }
    expansionRounds += 1;
    log('query_guided_expand', { round: expansionRounds, request, missing: arr(response.missing).slice(0, 6) });
    expandNodes(local, request, arcs, question);
  }

  if (response?.status === 'incomplete') {
    response = await jsonCall(
      client,
      model,
      `${ANSWER_SYSTEM}\nExpansion is now closed. You MUST return status=complete using the available expanded evidence and list every unresolved requirement under dataView.missing.`,
      {
        question,
        intent: selection.intent,
        expansionRound: expansionRounds,
        expansionRoundsRemaining: 0,
        context: serializeLocalMap(local),
        unresolvedFromPreviousRound: arr(response.missing).slice(0, 8)
      },
      'forced_final_answer', usage, log
    );
  }

  return {
    ...response,
    investigation: {
      mode: 'select-frontier-expand-bounded',
      thinking: 'disabled',
      maxExpansionRounds: MAX_EXPANSION_ROUNDS,
      expansionRounds,
      selectedWorkflowIds: selection.workflowIds,
      selectedEntities: selection.entities,
      expandedEntityCount: local.expandedEntities.size,
      expandedWorkflowCount: local.expandedWorkflows.size,
      frontierEntityCount: local.frontierEntities.size,
      frontierWorkflowCount: local.frontierWorkflows.size,
      usage
    }
  };
}
