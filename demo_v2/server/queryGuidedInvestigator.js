const arr = (v) => Array.isArray(v) ? v : [];
const clean = (v, n = 180) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, n);
const key = (v) => String(v || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const uniq = (xs) => [...new Set(arr(xs).filter(Boolean).map(String))];

const MAX_EXPANSION_ROUNDS = 3;
const MAX_FIELDS_PER_ENTITY = 18;
const MAX_NEIGHBOURS_PER_NODE = 12;
const MAX_FRONTIER_ENTITIES = 28;
const MAX_FRONTIER_WORKFLOWS = 18;

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

function entitiesForWorkflow(workflowId, arcs) {
  const arc = arcs.find((a) => String(a.id) === String(workflowId));
  if (!arc) return [];
  const catalog = new Map(entityCatalog(arcs).map((e) => [key(e.name), e]));
  return uniq([...arr(arc.entities), ...arr(arc.persistentObjects), ...arr(arc.entityDetails).map((d) => d?.name)])
    .filter(friendlyName)
    .map((name) => catalog.get(key(name)) || { name, description: '' });
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
  const connected = new Map();
  for (const relation of relationsForEntity(base.name, arcs)) {
    const other = key(relation.from) === key(base.name) ? relation.to : relation.from;
    const entity = catalog.get(key(other)) || { name: other, description: '' };
    connected.set(key(entity.name), { name: entity.name, description: clean(entity.description, 120), relation });
  }
  return {
    kind: 'entity',
    name: base.name,
    description: clean(base.description, 150),
    fields: fieldsForEntity(base.name, arcs, question),
    connectedEntities: [...connected.values()].slice(0, MAX_NEIGHBOURS_PER_NODE),
    workflows: workflowsForEntity(base.name, arcs).slice(0, MAX_NEIGHBOURS_PER_NODE),
    relations: relationsForEntity(base.name, arcs)
  };
}

function workflowDetail(workflowId, arcs) {
  const arc = arcs.find((a) => String(a.id) === String(workflowId));
  if (!arc) return null;
  return {
    kind: 'workflow',
    id: String(arc.id),
    name: clean(arc.title, 110),
    description: clean(arc.businessIntent || arc.businessOutcome || arc.outcome, 150),
    entities: entitiesForWorkflow(arc.id, arcs).slice(0, 16),
    relatedWorkflows: relatedWorkflows(arc.id, arcs).slice(0, MAX_NEIGHBOURS_PER_NODE),
    relations: relationsForWorkflow(arc.id, arcs)
  };
}

function createSession() {
  return {
    history: new Map(),
    frontierEntities: new Map(),
    frontierWorkflows: new Map(),
    trails: new Map(),
    currentEntities: new Map(),
    currentWorkflows: new Map()
  };
}

function nodeKey(kind, id) { return `${kind}:${kind === 'entity' ? key(id) : String(id)}`; }
function compactNode(kind, node) {
  return kind === 'entity'
    ? { kind, name: node.name, description: clean(node.description, 120) }
    : { kind, id: String(node.id), name: node.name, description: clean(node.description, 120) };
}
function compactTrail(trail) { return arr(trail).slice(-8).map((x) => compactNode(x.kind, x)); }

function addHistory(session, kind, node) {
  const id = kind === 'entity' ? node.name : node.id;
  session.history.set(nodeKey(kind, id), compactNode(kind, node));
}

function addFrontierEntity(session, entity, trail) {
  if (!entity?.name) return;
  const k = key(entity.name);
  if (session.currentEntities.has(k)) return;
  if (!session.frontierEntities.has(k) && session.frontierEntities.size < MAX_FRONTIER_ENTITIES) {
    session.frontierEntities.set(k, { name: entity.name, description: clean(entity.description, 120), state: 'unselected' });
    session.trails.set(nodeKey('entity', entity.name), compactTrail(trail));
  }
}
function addFrontierWorkflow(session, workflow, trail) {
  if (!workflow?.id) return;
  const id = String(workflow.id);
  if (session.currentWorkflows.has(id)) return;
  if (!session.frontierWorkflows.has(id) && session.frontierWorkflows.size < MAX_FRONTIER_WORKFLOWS) {
    session.frontierWorkflows.set(id, { id, name: workflow.name, description: clean(workflow.description, 120), state: 'unselected' });
    session.trails.set(nodeKey('workflow', id), compactTrail(trail));
  }
}

function beginExpansionRound(session) {
  for (const node of session.currentEntities.values()) addHistory(session, 'entity', node);
  for (const node of session.currentWorkflows.values()) addHistory(session, 'workflow', node);
  session.currentEntities.clear();
  session.currentWorkflows.clear();
}

function expandEntity(session, name, arcs, question, trail) {
  const detail = entityDetail(name, arcs, question);
  if (!detail?.name) return;
  const k = key(detail.name);
  session.frontierEntities.delete(k);
  session.currentEntities.set(k, detail);
  session.trails.set(nodeKey('entity', detail.name), compactTrail(trail));

  const baseTrail = [...compactTrail(trail), compactNode('entity', detail)];
  for (const connected of arr(detail.connectedEntities)) {
    addFrontierEntity(session, connected, [...baseTrail, { kind: 'entity', name: connected.name, description: connected.description }]);
  }
  for (const workflow of arr(detail.workflows)) {
    addFrontierWorkflow(session, workflow, [...baseTrail, { kind: 'workflow', id: workflow.id, name: workflow.name, description: workflow.description }]);
  }
}

function expandWorkflow(session, id, arcs, trail) {
  const detail = workflowDetail(id, arcs);
  if (!detail) return;
  const workflowId = String(detail.id);
  session.frontierWorkflows.delete(workflowId);
  session.currentWorkflows.set(workflowId, detail);
  session.trails.set(nodeKey('workflow', workflowId), compactTrail(trail));

  const baseTrail = [...compactTrail(trail), compactNode('workflow', detail)];
  for (const entity of arr(detail.entities)) {
    addFrontierEntity(session, entity, [...baseTrail, { kind: 'entity', name: entity.name, description: entity.description }]);
  }
  for (const workflow of arr(detail.relatedWorkflows)) {
    addFrontierWorkflow(session, workflow, [...baseTrail, { kind: 'workflow', id: workflow.id, name: workflow.name, description: workflow.description }]);
  }
}

function expandNodes(session, request, arcs, question, { initial = false } = {}) {
  beginExpansionRound(session);
  const entityCatalogByKey = new Map(entityCatalog(arcs).map((e) => [key(e.name), e]));
  const workflowCatalogById = new Map(arcs.map((a) => [String(a.id), { id: String(a.id), name: clean(a.title, 110), description: clean(a.businessIntent || a.outcome, 150) }]));

  for (const name of uniq(arr(request?.entities).filter(friendlyName))) {
    const existingTrail = session.trails.get(nodeKey('entity', name));
    const base = entityCatalogByKey.get(key(name)) || { name, description: '' };
    expandEntity(session, name, arcs, question, existingTrail || [compactNode('entity', base)]);
  }
  for (const id of uniq(arr(request?.workflowIds).map(String))) {
    const existingTrail = session.trails.get(nodeKey('workflow', id));
    const base = workflowCatalogById.get(id) || { id, name: id, description: '' };
    expandWorkflow(session, id, arcs, existingTrail || [compactNode('workflow', base)]);
  }

  if (initial) {
    for (const node of session.currentEntities.values()) session.trails.set(nodeKey('entity', node.name), [compactNode('entity', node)]);
    for (const node of session.currentWorkflows.values()) session.trails.set(nodeKey('workflow', node.id), [compactNode('workflow', node)]);
  }
}

function serializeCurrentEntity(session, entity) {
  return {
    kind: 'entity',
    name: entity.name,
    description: clean(entity.description, 120),
    fields: arr(entity.fields).map((f) => ({ field: f.field, type: f.type, description: clean(f.description, 90), isPk: f.isPk })),
    relatedEntities: arr(entity.connectedEntities).map((e) => ({ name: e.name, description: clean(e.description, 90), relation: clean(e.relation?.relation, 80), relationDescription: clean(e.relation?.description, 90) })),
    workflows: arr(entity.workflows).map((w) => ({ id: w.id, name: w.name, description: clean(w.description, 90) })),
    relations: arr(entity.relations).map((r) => ({ from: r.from, relation: r.relation, to: r.to, description: clean(r.description, 90) }))
  };
}
function serializeCurrentWorkflow(workflow) {
  return {
    kind: 'workflow',
    id: workflow.id,
    name: workflow.name,
    description: clean(workflow.description, 120),
    entities: arr(workflow.entities).map((e) => ({ name: e.name, description: clean(e.description, 90) })),
    relatedWorkflows: arr(workflow.relatedWorkflows).map((w) => ({ id: w.id, name: w.name, description: clean(w.description, 90) })),
    relations: arr(workflow.relations).map((r) => ({ from: r.from, relation: r.relation, to: r.to, description: clean(r.description, 90) }))
  };
}

function serializeContext(session) {
  const trailKeys = new Set();
  for (const node of session.currentEntities.values()) for (const t of arr(session.trails.get(nodeKey('entity', node.name)))) trailKeys.add(nodeKey(t.kind, t.kind === 'entity' ? t.name : t.id || t.name));
  for (const node of session.currentWorkflows.values()) for (const t of arr(session.trails.get(nodeKey('workflow', node.id)))) trailKeys.add(nodeKey(t.kind, t.kind === 'entity' ? t.name : t.id || t.name));

  const trail = [...session.history.entries()]
    .filter(([k]) => !trailKeys.size || trailKeys.has(k))
    .map(([, node]) => node)
    .slice(-16);

  return {
    trail,
    currentExpanded: {
      entities: [...session.currentEntities.values()].map((e) => serializeCurrentEntity(session, e)),
      workflows: [...session.currentWorkflows.values()].map(serializeCurrentWorkflow)
    },
    unselectedEntities: [...session.frontierEntities.values()].map((e) => ({ ...e, trail: session.trails.get(nodeKey('entity', e.name)) || [] })),
    unselectedWorkflows: [...session.frontierWorkflows.values()].map((w) => ({ ...w, trail: session.trails.get(nodeKey('workflow', w.id)) || [] }))
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

function normalizeExpansionRequest(response, session) {
  const availableEntityNames = new Map([...session.frontierEntities.values()].map((e) => [key(e.name), e.name]));
  const availableWorkflowIds = new Set([...session.frontierWorkflows.keys()]);
  return {
    entities: uniq(arr(response?.expandEntities).map((n) => availableEntityNames.get(key(n))).filter(Boolean)).slice(0, 4),
    workflowIds: uniq(arr(response?.expandWorkflowIds).map(String).filter((id) => availableWorkflowIds.has(id))).slice(0, 4)
  };
}

const ANSWER_SYSTEM = `Answer the user's question ONLY from the current semantic exploration context.
The context is intentionally asymmetric:
- trail: previously traversed nodes, name + description only;
- currentExpanded: ONLY the nodes expanded in this round, with fields, relations, connected entities/workflows and descriptions;
- unselectedEntities/unselectedWorkflows: frontier candidates, name + description + compact trail only.
For analytics, the final answer must be a DATA VIEW: exact entities, exact fields and the evidenced connections needed to form one combined view.
If more context is needed and expansion rounds remain, return:
{"status":"incomplete","missing":["short missing concept"],"expandEntities":["UNSELECTED entity name"],"expandWorkflowIds":["UNSELECTED workflow id"]}
Choose expansion targets only from the unselected frontier. If sufficient, return:
{"status":"complete","intent":"","answer":"2-4 concise sentences","dataView":{"grain":"","select":[{"entity":"","field":"","alias":"","role":"key|measure|dimension|time|attribute"}],"joins":[{"left":"Entity.field or Entity","right":"Entity.field or Entity","relation":"","evidenced":true}],"filters":[],"groupBy":[],"orderBy":[],"missing":[]},"nextStep":""}.
Never substitute a semantically different field for a requested concept. Use only supplied fields. If an exact field join is not evidenced, use an entity-level connection with evidenced=false or list the join under missing. Never expose implementation paths/classes/services.`;

export async function investigateQuery({ question, client, model, arcs, snapshot, mapStateForArc, pathHints = () => [], log = () => {} }) {
  const usage = { prompt: 0, completion: 0, total: 0 };
  const workflows = workflowCatalog(arcs, mapStateForArc, snapshot);
  const entities = entityCatalog(arcs);

  const selected = await jsonCall(
    client,
    model,
    `Given a business question and the COMPLETE top-level semantic catalog, select relevant starting points. The catalog contains all entity names/descriptions and workflow names/descriptions, but no fields. Return JSON only: {"intent":"data_analytics|web_analytics|operations|support|decision_support|engineering|other","workflowIds":[],"entities":[]}. Use only supplied names/IDs. Select at most 5 workflows and 6 entities. Do not answer yet.`,
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

  const session = createSession();
  expandNodes(session, selection, arcs, question, { initial: true });

  let response = null, expansionRounds = 0;
  for (let round = 0; round <= MAX_EXPANSION_ROUNDS; round += 1) {
    response = await jsonCall(
      client,
      model,
      ANSWER_SYSTEM,
      {
        question,
        intent: selection.intent,
        expansionRound: round,
        expansionRoundsRemaining: MAX_EXPANSION_ROUNDS - round,
        context: serializeContext(session),
        unlearnedHints: pathHints(question).slice(0, 2)
      },
      round === 0 ? 'answer_or_expand_0' : `answer_or_expand_${round}`,
      usage,
      log
    );

    if (response?.status !== 'incomplete' || round >= MAX_EXPANSION_ROUNDS) break;
    const request = normalizeExpansionRequest(response, session);
    if (!request.entities.length && !request.workflowIds.length) {
      log('query_guided_stop', { reason: 'model_requested_no_unselected_frontier_nodes', round, response });
      break;
    }
    expansionRounds += 1;
    log('query_guided_expand', { round: expansionRounds, request, missing: arr(response.missing).slice(0, 6) });
    expandNodes(session, request, arcs, question);
  }

  if (response?.status === 'incomplete') {
    response = await jsonCall(
      client,
      model,
      `${ANSWER_SYSTEM}\nExpansion is closed. MUST return status=complete and list unresolved requirements under dataView.missing.`,
      {
        question,
        intent: selection.intent,
        expansionRound: expansionRounds,
        expansionRoundsRemaining: 0,
        context: serializeContext(session),
        unresolvedFromPreviousRound: arr(response.missing).slice(0, 8)
      },
      'forced_final_answer', usage, log
    );
  }

  return {
    ...response,
    investigation: {
      mode: 'select-current-focus-expand-bounded',
      thinking: 'disabled',
      maxExpansionRounds: MAX_EXPANSION_ROUNDS,
      expansionRounds,
      selectedWorkflowIds: selection.workflowIds,
      selectedEntities: selection.entities,
      currentExpandedEntityCount: session.currentEntities.size,
      currentExpandedWorkflowCount: session.currentWorkflows.size,
      frontierEntityCount: session.frontierEntities.size,
      frontierWorkflowCount: session.frontierWorkflows.size,
      historyNodeCount: session.history.size,
      usage
    }
  };
}
