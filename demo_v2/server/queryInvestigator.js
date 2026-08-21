const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 320) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const MAX_TOOL_CALLS = 10;
const MAX_MODEL_ROUNDS = 4;
const MAX_BREADTH_CALLS = 2;
const MAX_NO_GAIN_STREAK = 2;
const BREADTH_TOOLS = new Set(['list_workflows', 'list_entities', 'search_map', 'get_unlearned_workflow_hints']);

function workflowSummary(arc, mapStateForArc, snapshot) {
  return {
    id: arc.id,
    name: clean(arc.title, 150),
    description: clean(arc.businessIntent || arc.outcome || arc.businessOutcome, 240),
    actor: clean(arc.businessActor || arc.trigger, 100),
    state: mapStateForArc(arc, snapshot)
  };
}

function workflowDetail(id, arcs, mapStateForArc, snapshot) {
  const arc = arcs.find((item) => item.id === id);
  if (!arc) return null;
  return {
    ...workflowSummary(arc, mapStateForArc, snapshot),
    trigger: clean(arc.trigger, 220),
    completionCondition: clean(arc.completionCondition, 240),
    outcome: clean(arc.businessOutcome || arc.outcome, 260),
    steps: arr(arc.workflowSteps).slice(0, 30).map((step, index) => ({
      order: index + 1,
      name: clean(step?.name, 150),
      description: clean(step?.description, 300),
      entities: uniq([...arr(step?.entities), ...arr(step?.persistentObjects)]).slice(0, 12),
      effect: clean(step?.effect, 200)
    })),
    entities: uniq([...arr(arc.entities), ...arr(arc.persistentObjects), ...arr(arc.entityDetails).map((d) => d?.name)]).slice(0, 30),
    relations: arr(arc.relationshipDetails).slice(0, 30).map((rel) => ({
      from: clean(rel?.from, 120), relation: clean(rel?.relation, 140), to: clean(rel?.to, 120), description: clean(rel?.description, 280)
    }))
  };
}

function entityCatalog(arcs) {
  const byKey = new Map();
  for (const arc of arcs) {
    for (const detail of arr(arc.entityDetails)) {
      const name = clean(detail?.name, 150); const k = key(name); if (!k) continue;
      const current = byKey.get(k) || { name, description: '', state: 'identified', workflowCount: 0, fieldCount: 0 };
      if (!current.description && detail?.description) current.description = clean(detail.description, 240);
      if (detail?.schemaResolved || arr(detail?.fields).length) current.state = 'explored';
      current.workflowCount += 1;
      current.fieldCount = Math.max(current.fieldCount, arr(detail?.fields).length);
      byKey.set(k, current);
    }
    for (const rawName of arr(arc.entities)) {
      const name = clean(rawName, 150); const k = key(name); if (!k || byKey.has(k)) continue;
      byKey.set(k, { name, description: '', state: 'identified', workflowCount: 1, fieldCount: 0 });
    }
  }
  return [...byKey.values()];
}

function entityDetail(name, arcs) {
  const wanted = key(name); const contexts = []; const representedBy = []; let description = ''; let schemaResolved = false;
  for (const arc of arcs) {
    const detail = arr(arc.entityDetails).find((d) => key(d?.name) === wanted);
    const mentioned = detail || arr(arc.entities).some((item) => key(item) === wanted) || arr(arc.persistentObjects).some((item) => key(item) === wanted);
    if (!mentioned) continue;
    if (!description && detail?.description) description = clean(detail.description, 320);
    schemaResolved = schemaResolved || !!detail?.schemaResolved;
    for (const item of arr(detail?.representedBy)) representedBy.push(item);
    for (const item of arr(arc.entityRepresentations).filter((r) => key(r?.businessEntity) === wanted)) {
      representedBy.push({ entityName: item.physicalEntity, relation: item.relation, description: item.description, confidence: item.confidence });
    }
    contexts.push({ workflowId: arc.id, workflowName: clean(arc.title, 150), role: clean(detail?.description || arc.businessIntent || arc.outcome, 260) });
  }
  return { name, description, schemaResolved, representedBy: representedBy.slice(0, 12), workflowContexts: contexts.slice(0, 12) };
}

function entityFields(name, arcs) {
  const wanted = key(name); const fields = new Map();
  for (const arc of arcs) {
    const detail = arr(arc.entityDetails).find((d) => key(d?.name) === wanted);
    for (const field of arr(detail?.fields)) {
      const fieldKey = `${key(field?.sourceEntity || detail?.name)}|${key(field?.physicalFieldName || field?.name)}`;
      if (!fields.has(fieldKey)) fields.set(fieldKey, {
        name: clean(field?.name, 140), type: clean(field?.type, 80), description: clean(field?.description, 260),
        sourceEntity: clean(field?.sourceEntity, 140), physicalFieldName: clean(field?.physicalFieldName, 140),
        authoritative: field?.authoritative === true, isPk: !!field?.isPk
      });
    }
  }
  return { entity: name, fields: [...fields.values()].slice(0, 100), missing: fields.size === 0 };
}

function relationsAround(name, arcs) {
  const wanted = key(name); const out = [];
  for (const arc of arcs) {
    for (const rel of arr(arc.relationshipDetails)) {
      if ([rel?.from, rel?.to].some((value) => key(value) === wanted) || key(rel?.relation).includes(wanted)) {
        out.push({ workflowId: arc.id, workflowName: clean(arc.title, 140), from: clean(rel?.from, 140), relation: clean(rel?.relation, 160), to: clean(rel?.to, 140), description: clean(rel?.description, 280) });
      }
    }
  }
  return out.slice(0, 40);
}

function workflowsForEntity(name, arcs, mapStateForArc, snapshot) {
  const wanted = key(name);
  return arcs.filter((arc) => arr(arc.entityDetails).some((d) => key(d?.name) === wanted)
      || arr(arc.entities).some((item) => key(item) === wanted)
      || arr(arc.persistentObjects).some((item) => key(item) === wanted))
    .map((arc) => ({ ...workflowSummary(arc, mapStateForArc, snapshot), role: clean(arc.businessIntent || arc.outcome, 220) })).slice(0, 20);
}

function lexicalScore(query, value) {
  const q = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const text = String(value || '').toLowerCase();
  if (!q.length || !text) return 0;
  return q.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0) / q.length;
}

function searchMap(query, arcs, mapStateForArc, snapshot) {
  const workflows = arcs.map((arc) => ({ item: workflowSummary(arc, mapStateForArc, snapshot), score: lexicalScore(query, `${arc.title} ${arc.businessIntent} ${arc.outcome} ${arr(arc.entities).join(' ')}`) }))
    .filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 10).map((item) => item.item);
  const entities = entityCatalog(arcs).map((entity) => ({ item: entity, score: lexicalScore(query, `${entity.name} ${entity.description}`) }))
    .filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 10).map((item) => item.item);
  return { workflows, entities };
}

function toolDefinitions() {
  const fn = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
  return [
    fn('list_workflows', 'List top-level learned business workflows with name and description. Use for broad orientation only.', { limit: { type: 'integer', minimum: 1, maximum: 50 } }),
    fn('list_entities', 'List top-level semantic entities with name and description. Use for broad orientation only.', { limit: { type: 'integer', minimum: 1, maximum: 80 } }),
    fn('get_workflow', 'Get ordered steps, entities and relations for one workflow.', { id: { type: 'string' } }, ['id']),
    fn('get_entity', 'Get semantic meaning, physical representations and workflow contexts for one entity.', { name: { type: 'string' } }, ['name']),
    fn('get_entity_fields', 'Get evidenced fields for one entity, including physical provenance where available.', { name: { type: 'string' } }, ['name']),
    fn('get_relations', 'Get semantic relations around an entity/concept across workflows.', { name: { type: 'string' } }, ['name']),
    fn('get_workflows_for_entity', 'Find workflows in which an entity participates and its business role.', { name: { type: 'string' } }, ['name']),
    fn('search_map', 'Search workflow/entity names and descriptions when the right concept is not yet known. Use sparingly.', { query: { type: 'string' } }, ['query']),
    fn('get_unlearned_workflow_hints', 'Get compact candidate workflow/path hints not yet semantically learned. These are leads, not established evidence.', { query: { type: 'string' } }, ['query']),
    fn('get_query_context', 'Return the compact accumulated investigation context, visited evidence, gaps and remaining budget.'),
    fn('finalize_investigation', 'Freeze the current evidence into a compact answer packet when enough evidence has been gathered or the remaining gap cannot be resolved.')
  ];
}

function createSession(question) {
  return {
    question, intent: '', status: 'investigating', toolCalls: 0, modelRounds: 0, breadthCalls: 0, noGainStreak: 0,
    seenCalls: new Set(), visited: { workflows: new Set(), entities: new Set(), relations: new Set() },
    evidence: { workflows: new Map(), entities: new Map(), fields: new Map(), relations: new Map(), pathHints: new Map() },
    gaps: [], finalizedPacket: null
  };
}

function evidenceCount(session) {
  return session.evidence.workflows.size + session.evidence.entities.size + session.evidence.fields.size + session.evidence.relations.size + session.evidence.pathHints.size;
}

function rememberResult(session, tool, args, result) {
  if (tool === 'list_workflows') for (const item of arr(result)) session.evidence.workflows.set(item.id, item);
  if (tool === 'get_workflow' && result?.id) { session.evidence.workflows.set(result.id, result); session.visited.workflows.add(result.id); }
  if (tool === 'list_entities') for (const item of arr(result)) session.evidence.entities.set(key(item.name), item);
  if (tool === 'get_entity' && result?.name) { session.evidence.entities.set(key(result.name), result); session.visited.entities.add(key(result.name)); }
  if (tool === 'get_entity_fields') {
    const entityKey = key(result?.entity || args?.name); if (entityKey) session.evidence.fields.set(entityKey, result);
  }
  if (tool === 'get_relations') for (const item of arr(result)) {
    const relationKey = `${item.workflowId}|${key(item.from)}|${key(item.relation)}|${key(item.to)}`;
    session.evidence.relations.set(relationKey, item); session.visited.relations.add(relationKey);
  }
  if (tool === 'get_workflows_for_entity') for (const item of arr(result)) session.evidence.workflows.set(item.id, item);
  if (tool === 'search_map') {
    for (const item of arr(result?.workflows)) session.evidence.workflows.set(item.id, item);
    for (const item of arr(result?.entities)) session.evidence.entities.set(key(item.name), item);
  }
  if (tool === 'get_unlearned_workflow_hints') for (const item of arr(result)) session.evidence.pathHints.set(item.id || item.pathId || JSON.stringify(item), item);
}

function queryContext(session) {
  return {
    question: session.question,
    intent: session.intent,
    status: session.status,
    established: {
      workflows: [...session.evidence.workflows.values()].slice(0, 12).map((item) => ({ id: item.id, name: item.name || item.title, description: item.description, state: item.state })),
      entities: [...session.evidence.entities.values()].slice(0, 20).map((item) => ({ name: item.name, description: item.description, state: item.state })),
      fieldEntities: [...session.evidence.fields.entries()].map(([entity, item]) => ({ entity, fieldCount: arr(item?.fields).length, missing: !!item?.missing })),
      relations: [...session.evidence.relations.values()].slice(0, 20),
      unlearnedHints: [...session.evidence.pathHints.values()].slice(0, 8)
    },
    gaps: session.gaps.slice(0, 8),
    budget: { toolCallsUsed: session.toolCalls, toolCallsRemaining: Math.max(0, MAX_TOOL_CALLS - session.toolCalls), breadthCallsUsed: session.breadthCalls, breadthCallsRemaining: Math.max(0, MAX_BREADTH_CALLS - session.breadthCalls), modelRoundsUsed: session.modelRounds, modelRoundsRemaining: Math.max(0, MAX_MODEL_ROUNDS - session.modelRounds) }
  };
}

function finalPacket(session) {
  if (session.finalizedPacket) return session.finalizedPacket;
  session.status = 'finalized';
  session.finalizedPacket = {
    question: session.question,
    intent: session.intent,
    workflows: [...session.evidence.workflows.values()].slice(0, 16),
    entities: [...session.evidence.entities.values()].slice(0, 24),
    fields: [...session.evidence.fields.values()].slice(0, 16),
    relations: [...session.evidence.relations.values()].slice(0, 30),
    unlearnedWorkflowHints: [...session.evidence.pathHints.values()].slice(0, 8),
    gaps: session.gaps.slice(0, 10),
    budget: queryContext(session).budget
  };
  return session.finalizedPacket;
}

function executeTool(name, args, { session, arcs, snapshot, mapStateForArc, pathHints }) {
  const tools = {
    list_workflows: () => arcs.map((arc) => workflowSummary(arc, mapStateForArc, snapshot)).slice(0, Math.min(50, Math.max(1, Number(args?.limit || 30)))),
    list_entities: () => entityCatalog(arcs).slice(0, Math.min(80, Math.max(1, Number(args?.limit || 50)))),
    get_workflow: () => workflowDetail(String(args?.id || ''), arcs, mapStateForArc, snapshot),
    get_entity: () => entityDetail(String(args?.name || ''), arcs),
    get_entity_fields: () => entityFields(String(args?.name || ''), arcs),
    get_relations: () => relationsAround(String(args?.name || ''), arcs),
    get_workflows_for_entity: () => workflowsForEntity(String(args?.name || ''), arcs, mapStateForArc, snapshot),
    search_map: () => searchMap(String(args?.query || ''), arcs, mapStateForArc, snapshot),
    get_unlearned_workflow_hints: () => pathHints(String(args?.query || '')).slice(0, 8),
    get_query_context: () => queryContext(session),
    finalize_investigation: () => finalPacket(session)
  };
  return tools[name] ? tools[name]() : { error: `Unknown semantic-map tool: ${name}` };
}

function parseArgs(raw) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
function normalizedUsage(usage = {}) {
  const prompt = Number(usage.prompt_tokens || usage.input_tokens || 0), completion = Number(usage.completion_tokens || usage.output_tokens || 0);
  const details = usage.prompt_tokens_details || {};
  return { prompt, completion, total: Number(usage.total_tokens || prompt + completion), cacheHit: Number(details.cached_tokens || usage.prompt_cache_hit_tokens || 0), cacheMiss: Number(usage.prompt_cache_miss_tokens || 0) };
}
function addUsage(total, usage) { for (const name of Object.keys(total)) total[name] += Number(usage[name] || 0); }

export async function investigateQuery({ question, client, model, arcs, snapshot, mapStateForArc, pathHints = () => [], log = () => {} }) {
  const session = createSession(question);
  const usage = { prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 };
  const messages = [
    { role: 'system', content: `You are lemap's enterprise semantic-map investigator. You receive a business question but no map dump. Navigate the semantic map using the supplied tools. First infer the question intent: data_analytics, web_analytics, operations, support, decision_support, engineering, or other. Explore only enough evidence to answer. For analytics, discover the fact/event grain, dimensions, measures, joins and filters; do not require a literal entity named Sales when orders/order-items/shipment evidence can represent sales. Region may be reachable through address/geography. For web analytics connect behavior/search/click/session evidence to conversion/order evidence only when the map supports it. Never invent fields, workflows, measurements or joins. Unlearned path hints are leads only. You have a strict exploration budget: at most ${MAX_TOOL_CALLS} tools, ${MAX_BREADTH_CALLS} breadth calls and ${MAX_MODEL_ROUNDS} model rounds. Repeated calls are rejected. Stop when enough evidence exists or further exploration cannot resolve the gap. Call finalize_investigation when done, then answer from the finalized evidence.` },
    { role: 'user', content: `QUESTION\n${question}` }
  ];

  let lastAssistant = null;
  for (let round = 0; round < MAX_MODEL_ROUNDS; round += 1) {
    session.modelRounds = round + 1;
    const completion = await client.chat.completions.create({ model, messages, tools: toolDefinitions(), tool_choice: 'auto', temperature: 0.1, max_tokens: 1200 });
    addUsage(usage, normalizedUsage(completion.usage || {}));
    const message = completion.choices?.[0]?.message || {};
    lastAssistant = message;
    messages.push({ role: 'assistant', content: message.content || null, tool_calls: message.tool_calls || undefined });
    log('query_agent_round', { round: round + 1, content: message.content || '', toolCalls: message.tool_calls || [], usage: normalizedUsage(completion.usage || {}), context: queryContext(session) });

    const toolCalls = arr(message.tool_calls);
    if (!toolCalls.length) break;

    for (const call of toolCalls) {
      if (session.toolCalls >= MAX_TOOL_CALLS) break;
      const name = String(call?.function?.name || ''); const args = parseArgs(call?.function?.arguments);
      const fingerprint = `${name}:${JSON.stringify(args)}`;
      let result;
      if (session.seenCalls.has(fingerprint)) {
        result = { rejected: true, reason: 'duplicate_tool_call', context: queryContext(session) };
      } else if (BREADTH_TOOLS.has(name) && session.breadthCalls >= MAX_BREADTH_CALLS) {
        result = { rejected: true, reason: 'breadth_budget_exhausted', context: queryContext(session) };
      } else {
        session.seenCalls.add(fingerprint); session.toolCalls += 1; if (BREADTH_TOOLS.has(name)) session.breadthCalls += 1;
        const before = evidenceCount(session);
        result = executeTool(name, args, { session, arcs, snapshot, mapStateForArc, pathHints });
        rememberResult(session, name, args, result);
        const gain = evidenceCount(session) - before;
        session.noGainStreak = gain > 0 || ['get_query_context', 'finalize_investigation'].includes(name) ? 0 : session.noGainStreak + 1;
        if (name === 'finalize_investigation') session.status = 'finalized';
        result = { result, newEvidence: gain, budget: queryContext(session).budget };
      }
      log('query_agent_tool', { tool: name, args, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }

    if (session.status === 'finalized') break;
    if (session.toolCalls >= MAX_TOOL_CALLS || session.noGainStreak >= MAX_NO_GAIN_STREAK) {
      session.gaps.push(session.toolCalls >= MAX_TOOL_CALLS ? 'Investigation tool budget exhausted.' : 'Further tool calls stopped adding new evidence.');
      finalPacket(session);
      break;
    }
  }

  const packet = finalPacket(session);
  const answerSystem = `You are lemap's enterprise query reasoner. Answer the original question using ONLY the finalized semantic evidence packet. Classify/retain the intent. For data analytics, propose the smallest grounded combined data view with fact grain, entities, joins, dimensions, measures and filters. For web analytics, describe the behavioral-to-conversion path only if evidenced and flag missing instrumentation. For operations/support/decision/engineering questions, answer using the relevant workflows/entities/relations instead of forcing an analytical view. Never invent measured values, fields or relationships. Clearly state missing evidence. Return strict JSON: {"intent":"","answer":"","workflowsUsed":[{"id":"","title":"","role":""}],"relevantEntities":[],"relevantRelationships":[],"candidateView":{"purpose":"","factGrain":"","entities":[],"joins":[],"dimensions":[],"measures":[],"filters":[],"missing":[]},"scenarios":[{"scenario":"","why":"","dataToCheck":[]}],"missingEvidence":[],"nextStep":""}.`;
  const answerCompletion = await client.chat.completions.create({ model, messages: [{ role: 'system', content: answerSystem }, { role: 'user', content: `QUESTION\n${question}\n\nFINALIZED_EVIDENCE\n${JSON.stringify(packet)}` }], response_format: { type: 'json_object' }, temperature: 0.1, max_tokens: 1700 });
  const answerUsage = normalizedUsage(answerCompletion.usage || {}); addUsage(usage, answerUsage);
  const raw = answerCompletion.choices?.[0]?.message?.content || '{}';
  let parsed = {}; try { parsed = JSON.parse(raw); } catch { parsed = { intent: session.intent || '', answer: raw }; }
  log('query_agent_answer', { response: parsed, usage: answerUsage, packet });
  return { ...parsed, investigation: { status: session.status, toolCalls: session.toolCalls, modelRounds: session.modelRounds, breadthCalls: session.breadthCalls, visited: { workflows: [...session.visited.workflows], entities: [...session.visited.entities] }, gaps: session.gaps, usage } };
}
