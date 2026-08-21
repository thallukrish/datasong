const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 320) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const MAX_TOOL_CALLS = 9;
const MAX_MODEL_ROUNDS = 4;
const MAX_BREADTH_CALLS = 2;
const MAX_NO_GAIN_STREAK = 2;
const DEFAULT_FIELD_LIMIT = 18;
const BREADTH_TOOLS = new Set(['list_workflows', 'list_entities', 'search_map', 'get_unlearned_workflow_hints']);

function workflowSummary(arc, mapStateForArc, snapshot) {
  return { id: arc.id, name: clean(arc.title, 130), description: clean(arc.businessIntent || arc.outcome || arc.businessOutcome, 190), state: mapStateForArc(arc, snapshot) };
}

function workflowDetail(id, arcs, mapStateForArc, snapshot) {
  const arc = arcs.find((item) => item.id === id);
  if (!arc) return null;
  return {
    ...workflowSummary(arc, mapStateForArc, snapshot),
    trigger: clean(arc.trigger, 160), completionCondition: clean(arc.completionCondition, 180),
    steps: arr(arc.workflowSteps).slice(0, 18).map((step, index) => ({ order: index + 1, name: clean(step?.name, 120), description: clean(step?.description, 190), entities: uniq([...arr(step?.entities), ...arr(step?.persistentObjects)]).slice(0, 8) })),
    entities: uniq([...arr(arc.entities), ...arr(arc.persistentObjects), ...arr(arc.entityDetails).map((d) => d?.name)]).slice(0, 20),
    relations: arr(arc.relationshipDetails).slice(0, 18).map((rel) => ({ from: clean(rel?.from, 100), relation: clean(rel?.relation, 110), to: clean(rel?.to, 100), description: clean(rel?.description, 180) }))
  };
}

function entityCatalog(arcs) {
  const byKey = new Map();
  for (const arc of arcs) {
    for (const detail of arr(arc.entityDetails)) {
      const name = clean(detail?.name, 120); const k = key(name); if (!k) continue;
      const current = byKey.get(k) || { name, description: '', state: 'identified', fieldCount: 0 };
      if (!current.description && detail?.description) current.description = clean(detail.description, 170);
      if (detail?.schemaResolved || arr(detail?.fields).length) current.state = 'explored';
      current.fieldCount = Math.max(current.fieldCount, arr(detail?.fields).length);
      byKey.set(k, current);
    }
    for (const rawName of arr(arc.entities)) {
      const name = clean(rawName, 120); const k = key(name); if (!k || byKey.has(k)) continue;
      byKey.set(k, { name, description: '', state: 'identified', fieldCount: 0 });
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
    if (!description && detail?.description) description = clean(detail.description, 220);
    schemaResolved = schemaResolved || !!detail?.schemaResolved;
    for (const item of arr(detail?.representedBy)) representedBy.push({ entityName: clean(item?.entityName, 120), relation: clean(item?.relation, 80), description: clean(item?.description, 160) });
    for (const item of arr(arc.entityRepresentations).filter((r) => key(r?.businessEntity) === wanted)) representedBy.push({ entityName: clean(item.physicalEntity, 120), relation: clean(item.relation, 80), description: clean(item.description, 160) });
    contexts.push({ workflowId: arc.id, workflowName: clean(arc.title, 120), role: clean(detail?.description || arc.businessIntent || arc.outcome, 180) });
  }
  return { name, description, schemaResolved, representedBy: representedBy.slice(0, 8), workflowContexts: contexts.slice(0, 8) };
}

function fieldMatches(field, query) {
  const words = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((v) => v.length > 2);
  if (!words.length) return true;
  const hay = `${field?.name || ''} ${field?.physicalFieldName || ''} ${field?.description || ''} ${field?.type || ''}`.toLowerCase();
  return words.some((word) => hay.includes(word));
}

function entityFields(name, arcs, args = {}) {
  const wanted = key(name); const fields = new Map();
  for (const arc of arcs) {
    const detail = arr(arc.entityDetails).find((d) => key(d?.name) === wanted);
    for (const field of arr(detail?.fields)) {
      const fieldKey = `${key(field?.sourceEntity || detail?.name)}|${key(field?.physicalFieldName || field?.name)}`;
      if (!fields.has(fieldKey)) fields.set(fieldKey, {
        entity: clean(field?.sourceEntity || detail?.name || name, 120), name: clean(field?.name, 120), type: clean(field?.type, 60),
        description: clean(field?.description, 160), physicalFieldName: clean(field?.physicalFieldName, 120), authoritative: field?.authoritative === true, isPk: !!field?.isPk
      });
    }
  }
  const all = [...fields.values()];
  const requested = clean(args?.query, 160);
  const relevant = requested ? all.filter((field) => fieldMatches(field, requested)) : all;
  const primary = all.filter((field) => field.isPk);
  const combined = uniq([...primary.map(JSON.stringify), ...relevant.map(JSON.stringify), ...all.map(JSON.stringify)]).map(JSON.parse);
  const limit = Math.min(30, Math.max(4, Number(args?.limit || DEFAULT_FIELD_LIMIT)));
  return { entity: name, totalFields: all.length, fields: combined.slice(0, limit), missing: all.length === 0, query: requested };
}

function relationsAround(name, arcs) {
  const wanted = key(name); const out = [];
  for (const arc of arcs) for (const rel of arr(arc.relationshipDetails)) {
    if ([rel?.from, rel?.to].some((value) => key(value) === wanted) || key(rel?.relation).includes(wanted)) out.push({ workflowId: arc.id, workflowName: clean(arc.title, 110), from: clean(rel?.from, 110), relation: clean(rel?.relation, 120), to: clean(rel?.to, 110), description: clean(rel?.description, 170) });
  }
  return out.slice(0, 24);
}

function workflowsForEntity(name, arcs, mapStateForArc, snapshot) {
  const wanted = key(name);
  return arcs.filter((arc) => arr(arc.entityDetails).some((d) => key(d?.name) === wanted) || arr(arc.entities).some((item) => key(item) === wanted) || arr(arc.persistentObjects).some((item) => key(item) === wanted))
    .map((arc) => workflowSummary(arc, mapStateForArc, snapshot)).slice(0, 12);
}

function lexicalScore(query, value) {
  const q = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const text = String(value || '').toLowerCase(); if (!q.length || !text) return 0;
  return q.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0) / q.length;
}

function searchMap(query, arcs, mapStateForArc, snapshot) {
  const workflows = arcs.map((arc) => ({ item: workflowSummary(arc, mapStateForArc, snapshot), score: lexicalScore(query, `${arc.title} ${arc.businessIntent} ${arc.outcome} ${arr(arc.entities).join(' ')}`) })).filter((x) => x.score > 0).sort((a,b) => b.score-a.score).slice(0,8).map((x) => x.item);
  const entities = entityCatalog(arcs).map((entity) => ({ item: entity, score: lexicalScore(query, `${entity.name} ${entity.description}`) })).filter((x) => x.score > 0).sort((a,b) => b.score-a.score).slice(0,8).map((x) => x.item);
  return { workflows, entities };
}

function toolDefinitions() {
  const fn = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
  return [
    fn('list_workflows', 'List top-level learned workflows with name and description. Breadth tool.', { limit: { type: 'integer', minimum: 1, maximum: 30 } }),
    fn('list_entities', 'List top-level semantic entities with name and description. Breadth tool.', { limit: { type: 'integer', minimum: 1, maximum: 50 } }),
    fn('get_workflow', 'Get one workflow steps, entities and relations.', { id: { type: 'string' } }, ['id']),
    fn('get_entity', 'Get semantic meaning and workflow contexts for one entity.', { name: { type: 'string' } }, ['name']),
    fn('get_entity_fields', 'Get a small projected set of evidenced fields for one entity. query should describe needed roles such as amount date status product region id.', { name: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 4, maximum: 30 } }, ['name']),
    fn('get_relations', 'Get relations around an entity/concept.', { name: { type: 'string' } }, ['name']),
    fn('get_workflows_for_entity', 'Find workflows using an entity.', { name: { type: 'string' } }, ['name']),
    fn('search_map', 'Search names/descriptions when the right concept is unknown. Breadth tool.', { query: { type: 'string' } }, ['query']),
    fn('get_unlearned_workflow_hints', 'Get compact unlearned path hints. Leads only. Breadth tool.', { query: { type: 'string' } }, ['query']),
    fn('get_query_context', 'Get compact accumulated evidence and remaining budget.'),
    fn('finalize_investigation', 'Finalize only when required evidence is known or explicitly missing.')
  ];
}

function createSession(question) {
  return { question, intent: '', status: 'investigating', toolCalls: 0, modelRounds: 0, breadthCalls: 0, noGainStreak: 0, seenCalls: new Set(), evidence: { workflows: new Map(), entities: new Map(), fields: new Map(), relations: new Map(), pathHints: new Map() }, gaps: [], finalizedPacket: null };
}

function evidenceCount(session) { return session.evidence.workflows.size + session.evidence.entities.size + session.evidence.fields.size + session.evidence.relations.size + session.evidence.pathHints.size; }

function rememberResult(session, tool, args, result) {
  if (tool === 'list_workflows') for (const item of arr(result)) session.evidence.workflows.set(item.id, item);
  if (tool === 'get_workflow' && result?.id) session.evidence.workflows.set(result.id, result);
  if (tool === 'list_entities') for (const item of arr(result)) session.evidence.entities.set(key(item.name), item);
  if (tool === 'get_entity' && result?.name) session.evidence.entities.set(key(result.name), result);
  if (tool === 'get_entity_fields') { const k = key(result?.entity || args?.name); if (k) session.evidence.fields.set(k, result); }
  if (tool === 'get_relations') for (const item of arr(result)) session.evidence.relations.set(`${item.workflowId}|${key(item.from)}|${key(item.relation)}|${key(item.to)}`, item);
  if (tool === 'get_workflows_for_entity') for (const item of arr(result)) session.evidence.workflows.set(item.id, item);
  if (tool === 'search_map') { for (const item of arr(result?.workflows)) session.evidence.workflows.set(item.id, item); for (const item of arr(result?.entities)) session.evidence.entities.set(key(item.name), item); }
  if (tool === 'get_unlearned_workflow_hints') for (const item of arr(result)) session.evidence.pathHints.set(item.id || item.pathId || JSON.stringify(item), item);
}

function compactContext(session) {
  return {
    intent: session.intent,
    workflows: [...session.evidence.workflows.values()].slice(0,8).map((x) => ({ id:x.id, name:x.name || x.title, description:clean(x.description,120), state:x.state })),
    entities: [...session.evidence.entities.values()].slice(0,12).map((x) => ({ name:x.name, description:clean(x.description,120), fieldCount:x.fieldCount })),
    fieldEntities: [...session.evidence.fields.values()].map((x) => ({ entity:x.entity, fields:arr(x.fields).map((f) => `${f.entity || x.entity}.${f.name}`).slice(0,18), totalFields:x.totalFields })),
    relations: [...session.evidence.relations.values()].slice(0,12).map((r) => `${r.from} --${r.relation}--> ${r.to}`),
    gaps: session.gaps.slice(0,6),
    budget: { toolsRemaining: MAX_TOOL_CALLS-session.toolCalls, breadthRemaining: MAX_BREADTH_CALLS-session.breadthCalls, roundsRemaining: MAX_MODEL_ROUNDS-session.modelRounds }
  };
}

function finalPacket(session) {
  if (session.finalizedPacket) return session.finalizedPacket;
  session.status = 'finalized';
  session.finalizedPacket = {
    question: session.question, intent: session.intent,
    workflows: [...session.evidence.workflows.values()].slice(0,10),
    entities: [...session.evidence.entities.values()].slice(0,16),
    fields: [...session.evidence.fields.values()].slice(0,12),
    relations: [...session.evidence.relations.values()].slice(0,18),
    unlearnedWorkflowHints: [...session.evidence.pathHints.values()].slice(0,5),
    gaps: session.gaps.slice(0,8)
  };
  return session.finalizedPacket;
}

function executeTool(name, args, ctx) {
  const { session, arcs, snapshot, mapStateForArc, pathHints } = ctx;
  const tools = {
    list_workflows: () => arcs.map((arc) => workflowSummary(arc, mapStateForArc, snapshot)).slice(0, Math.min(30, Math.max(1, Number(args?.limit || 20)))),
    list_entities: () => entityCatalog(arcs).slice(0, Math.min(50, Math.max(1, Number(args?.limit || 30)))),
    get_workflow: () => workflowDetail(String(args?.id || ''), arcs, mapStateForArc, snapshot),
    get_entity: () => entityDetail(String(args?.name || ''), arcs),
    get_entity_fields: () => entityFields(String(args?.name || ''), arcs, args),
    get_relations: () => relationsAround(String(args?.name || ''), arcs),
    get_workflows_for_entity: () => workflowsForEntity(String(args?.name || ''), arcs, mapStateForArc, snapshot),
    search_map: () => searchMap(String(args?.query || ''), arcs, mapStateForArc, snapshot),
    get_unlearned_workflow_hints: () => pathHints(String(args?.query || '')).slice(0,5),
    get_query_context: () => compactContext(session),
    finalize_investigation: () => finalPacket(session)
  };
  return tools[name] ? tools[name]() : { error:`Unknown tool ${name}` };
}

function parseArgs(raw) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
function normalizedUsage(usage = {}) { const prompt=Number(usage.prompt_tokens||usage.input_tokens||0), completion=Number(usage.completion_tokens||usage.output_tokens||0), details=usage.prompt_tokens_details||{}; return { prompt, completion, total:Number(usage.total_tokens||prompt+completion), cacheHit:Number(details.cached_tokens||usage.prompt_cache_hit_tokens||0), cacheMiss:Number(usage.prompt_cache_miss_tokens||0) }; }
function addUsage(total, usage) { for (const k of Object.keys(total)) total[k] += Number(usage[k] || 0); }

const SYSTEM = `You are lemap's semantic-map investigator. Infer intent as data_analytics, web_analytics, operations, support, decision_support, engineering, or other. Navigate using tools only as needed. For data_analytics you MUST identify: (1) fact/event grain, (2) exact evidenced fields for measures/dimensions/keys, (3) joins or explicitly missing joins, and (4) filters/grouping/ranking needed by the question. You may not finalize a data_analytics query merely with entity names. Every field proposed in the final view must have been returned by get_entity_fields. Do not invent joins or statuses. Use get_entity_fields with a narrow query to conserve tokens. Unlearned hints are leads only. Stop when requirements are evidenced or explicitly unresolved.`;

export async function investigateQuery({ question, client, model, arcs, snapshot, mapStateForArc, pathHints = () => [], log = () => {} }) {
  const session = createSession(question);
  const usage = { prompt:0, completion:0, total:0, cacheHit:0, cacheMiss:0 };
  let latestToolSummary = '';

  for (let round=0; round<MAX_MODEL_ROUNDS; round+=1) {
    session.modelRounds = round+1;
    const user = `QUESTION\n${question}\n\nCURRENT_CONTEXT\n${JSON.stringify(compactContext(session))}${latestToolSummary ? `\n\nLATEST_TOOL_RESULT\n${latestToolSummary}` : ''}`;
    const completion = await client.chat.completions.create({ model, messages:[{role:'system',content:SYSTEM},{role:'user',content:user}], tools:toolDefinitions(), tool_choice:'auto', temperature:0.1, max_tokens:700 });
    const roundUsage = normalizedUsage(completion.usage||{}); addUsage(usage, roundUsage);
    const message = completion.choices?.[0]?.message || {};
    log('query_agent_round',{ round:round+1, content:message.content||'', toolCalls:message.tool_calls||[], usage:roundUsage, context:compactContext(session) });
    const calls = arr(message.tool_calls);
    if (!calls.length) break;
    const summaries=[];
    for (const call of calls) {
      if (session.toolCalls>=MAX_TOOL_CALLS) break;
      const name=String(call?.function?.name||''); const args=parseArgs(call?.function?.arguments); const fingerprint=`${name}:${JSON.stringify(args)}`;
      let wrapped;
      if (session.seenCalls.has(fingerprint)) wrapped={ rejected:true, reason:'duplicate_tool_call' };
      else if (BREADTH_TOOLS.has(name) && session.breadthCalls>=MAX_BREADTH_CALLS) wrapped={ rejected:true, reason:'breadth_budget_exhausted' };
      else {
        session.seenCalls.add(fingerprint); session.toolCalls+=1; if (BREADTH_TOOLS.has(name)) session.breadthCalls+=1;
        const before=evidenceCount(session); const result=executeTool(name,args,{session,arcs,snapshot,mapStateForArc,pathHints}); rememberResult(session,name,args,result); const gain=evidenceCount(session)-before;
        session.noGainStreak = gain>0 || ['get_query_context','finalize_investigation'].includes(name) ? 0 : session.noGainStreak+1;
        if (name==='finalize_investigation') session.status='finalized';
        wrapped={ result, newEvidence:gain, budget:compactContext(session).budget };
      }
      log('query_agent_tool',{tool:name,args,result:wrapped});
      summaries.push(`${name} ${JSON.stringify(args)} => ${JSON.stringify(wrapped).slice(0,2600)}`);
    }
    latestToolSummary=summaries.join('\n').slice(0,5200);
    if (session.status==='finalized') break;
    if (session.toolCalls>=MAX_TOOL_CALLS || session.noGainStreak>=MAX_NO_GAIN_STREAK) { session.gaps.push(session.toolCalls>=MAX_TOOL_CALLS?'Investigation tool budget exhausted.':'Further tool calls stopped adding new evidence.'); finalPacket(session); break; }
  }

  const packet=finalPacket(session);
  const answerSystem=`You are lemap's enterprise query reasoner. Use ONLY the supplied evidence. Return strict JSON. For data_analytics, dataView is mandatory and must be field-level. Every select/groupBy/orderBy/filter field must exactly match a field present in FINALIZED_EVIDENCE.fields. A join may be marked evidenced=false when the semantic map suggests it but does not establish exact keys. Never invent a field. JSON contract: {"intent":"","answer":"short natural-language answer","dataView":{"purpose":"","grain":"","select":[{"entity":"","field":"","alias":"","role":"key|measure|dimension|time|attribute"}],"joins":[{"left":"Entity.field or entity","right":"Entity.field or entity","relation":"","evidenced":true}],"filters":[{"field":"Entity.field","condition":"","evidenced":true}],"groupBy":["Entity.field"],"orderBy":[{"field":"Entity.field","direction":"asc|desc"}],"missing":[]},"missingEvidence":[],"nextStep":""}. For non-analytics intents dataView may be null.`;
  const answerCompletion=await client.chat.completions.create({ model, messages:[{role:'system',content:answerSystem},{role:'user',content:`QUESTION\n${question}\n\nFINALIZED_EVIDENCE\n${JSON.stringify(packet)}`}], response_format:{type:'json_object'}, temperature:0.1, max_tokens:1100 });
  const answerUsage=normalizedUsage(answerCompletion.usage||{}); addUsage(usage,answerUsage);
  const raw=answerCompletion.choices?.[0]?.message?.content||'{}'; let parsed={}; try{parsed=JSON.parse(raw);}catch{parsed={intent:session.intent||'',answer:raw,dataView:null};}
  log('query_agent_answer',{response:parsed,usage:answerUsage,packet});
  return { ...parsed, investigation:{ status:session.status, toolCalls:session.toolCalls, modelRounds:session.modelRounds, breadthCalls:session.breadthCalls, gaps:session.gaps, usage } };
}
