const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 320) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function entityCatalog(arcs) {
  const byName = new Map();
  for (const arc of arcs) {
    for (const detail of arr(arc.entityDetails)) {
      const name = String(detail?.name || ''); if (!name) continue;
      const k = key(name);
      const item = byName.get(k) || { name, description: '', workflows: [], schemaResolved: false, fieldCount: 0 };
      if (!item.description && detail.description) item.description = clean(detail.description, 240);
      item.schemaResolved = item.schemaResolved || !!detail.schemaResolved;
      item.fieldCount = Math.max(item.fieldCount, arr(detail.fields).length);
      item.workflows.push({ id: arc.id, title: clean(arc.title, 120), role: clean(arc.businessIntent || arc.outcome, 160) });
      byName.set(k, item);
    }
    for (const name of arr(arc.entities)) {
      const k = key(name); if (!k || byName.has(k)) continue;
      byName.set(k, { name, description: '', workflows: [{ id: arc.id, title: clean(arc.title, 120), role: clean(arc.businessIntent || arc.outcome, 160) }], schemaResolved: false, fieldCount: 0 });
    }
  }
  return [...byName.values()].map((item) => ({ ...item, workflows: item.workflows.slice(0, 5) }));
}

function workflowCatalog(arcs, mapStateForArc, snapshot) {
  return arcs.map((arc) => ({
    id: arc.id,
    title: clean(arc.title, 150),
    description: clean(arc.businessIntent || arc.outcome || arc.businessOutcome, 220),
    actor: clean(arc.businessActor || arc.trigger, 100),
    state: mapStateForArc(arc, snapshot),
    entities: uniq([...arr(arc.entities), ...arr(arc.entityDetails).map((d) => d?.name)]).slice(0, 12)
  }));
}

function entityDetail(name, arcs) {
  const wanted = key(name);
  const contexts = [];
  const fields = new Map();
  let description = '';
  let schemaResolved = false;
  const representedBy = [];
  for (const arc of arcs) {
    const detail = arr(arc.entityDetails).find((d) => key(d?.name) === wanted);
    const mentioned = detail || arr(arc.entities).some((e) => key(e) === wanted);
    if (!mentioned) continue;
    if (detail?.description && !description) description = clean(detail.description, 300);
    schemaResolved = schemaResolved || !!detail?.schemaResolved;
    for (const f of arr(detail?.fields)) {
      const fk = `${key(f?.sourceEntity || detail?.name)}|${key(f?.physicalFieldName || f?.name)}`;
      if (!fields.has(fk)) fields.set(fk, {
        name: clean(f?.name, 120), type: clean(f?.type, 70), description: clean(f?.description, 220),
        sourceEntity: clean(f?.sourceEntity, 120), physicalFieldName: clean(f?.physicalFieldName, 120), authoritative: f?.authoritative === true
      });
    }
    for (const r of arr(detail?.representedBy)) representedBy.push(r);
    for (const r of arr(arc.entityRepresentations).filter((r) => key(r?.businessEntity) === wanted)) representedBy.push({ entityName: r.physicalEntity, relation: r.relation, description: r.description, confidence: r.confidence });
    contexts.push({ workflowId: arc.id, workflowTitle: clean(arc.title, 140), context: clean(detail?.description || arc.businessIntent || arc.outcome, 240) });
  }
  return {
    name, description, schemaResolved,
    representedBy: representedBy.slice(0, 10),
    fields: [...fields.values()].slice(0, 90),
    workflowContexts: contexts.slice(0, 8)
  };
}

function workflowDetail(id, arcs) {
  const arc = arcs.find((a) => a.id === id);
  if (!arc) return null;
  return {
    id: arc.id, title: clean(arc.title, 160), description: clean(arc.businessIntent || arc.outcome || arc.businessOutcome, 260),
    trigger: clean(arc.trigger, 220),
    steps: arr(arc.workflowSteps).slice(0, 24).map((s, i) => ({ order: i + 1, name: clean(s?.name, 150), description: clean(s?.description, 280), entities: uniq([...arr(s?.entities), ...arr(s?.persistentObjects)]).slice(0, 10), effect: clean(s?.effect, 180) })),
    entities: uniq([...arr(arc.entities), ...arr(arc.persistentObjects), ...arr(arc.entityDetails).map((d) => d?.name)]).slice(0, 24),
    relations: arr(arc.relationshipDetails).slice(0, 24).map((r) => ({ from: clean(r?.from, 120), relation: clean(r?.relation, 140), to: clean(r?.to, 120), description: clean(r?.description, 260) }))
  };
}

function relationsAround(name, arcs) {
  const wanted = key(name); const out = [];
  for (const arc of arcs) {
    for (const r of arr(arc.relationshipDetails)) {
      if ([r?.from, r?.to].some((v) => key(v) === wanted) || key(r?.relation).includes(wanted)) {
        out.push({ workflowId: arc.id, workflowTitle: clean(arc.title, 120), from: clean(r?.from, 120), relation: clean(r?.relation, 140), to: clean(r?.to, 120), description: clean(r?.description, 240) });
      }
    }
  }
  return out.slice(0, 30);
}

export async function investigateQuery({ question, clientCall, arcs, snapshot, mapStateForArc, pathHints = [], log = () => {} }) {
  const usage = { prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 };
  const addUsage = (u = {}) => { for (const k of Object.keys(usage)) usage[k] += Number(u[k] || 0); };
  const workflows = workflowCatalog(arcs, mapStateForArc, snapshot);
  const entities = entityCatalog(arcs);
  const tools = {
    workflow_detail: (args) => workflowDetail(String(args?.id || ''), arcs),
    entity_detail: (args) => entityDetail(String(args?.name || ''), arcs),
    relations_around: (args) => relationsAround(String(args?.name || ''), arcs),
    path_hints: () => pathHints.slice(0, 8)
  };

  const plannerSystem = `You are lemap's semantic-map investigator. Classify the user's intent as data_analytics, web_analytics, operations, support, decision_support, engineering, or other. You are given only top-level workflow/entity catalogs. Decide whether you can answer from those summaries or request a very small number of semantic tools. Do not assume an entity named Sales must exist: infer useful business paths such as orders/shipped orders, products, customer/address/geo, click/search/session flows when supported by the catalog. Never invent measured data. Return strict JSON: {"intent":"","reason":"","requests":[{"tool":"workflow_detail|entity_detail|relations_around|path_hints","args":{}}],"ready":false}. Request at most 4 tools per round.`;
  const initialUser = `QUESTION ${JSON.stringify(question)}\nWORKFLOWS ${JSON.stringify(workflows)}\nENTITIES ${JSON.stringify(entities)}\nRules: use descriptions and entity/workflow connections, not keyword matching alone. Ask only for details needed to construct the answer.`;
  const first = await clientCall(plannerSystem, initialUser, 800); addUsage(first.usage); log('investigator_plan', { prompt: initialUser, response: first.parsed, usage: first.usage });

  let plan = first.parsed || {};
  const observations = [];
  const seen = new Set();
  for (let round = 0; round < 3; round += 1) {
    const requests = arr(plan.requests).slice(0, 4);
    if (plan.ready || !requests.length) break;
    for (const req of requests) {
      const tool = String(req?.tool || ''); if (!tools[tool]) continue;
      const fingerprint = `${tool}:${JSON.stringify(req?.args || {})}`; if (seen.has(fingerprint)) continue; seen.add(fingerprint);
      const result = tools[tool](req.args || {});
      observations.push({ tool, args: req.args || {}, result });
    }
    if (!observations.length) break;
    const followSystem = `You are lemap's semantic-map investigator. Review the tool results gathered so far. If the business question can now be answered structurally, set ready=true. Otherwise request only missing details, at most 3 tools. Never request the same detail twice. Return strict JSON: {"intent":"","reason":"","requests":[{"tool":"workflow_detail|entity_detail|relations_around|path_hints","args":{}}],"ready":false}.`;
    const followUser = `QUESTION ${JSON.stringify(question)}\nTOOL_RESULTS ${JSON.stringify(observations.slice(-8))}`;
    const next = await clientCall(followSystem, followUser, 650); addUsage(next.usage); log('investigator_followup', { round, prompt: followUser, response: next.parsed, usage: next.usage });
    plan = next.parsed || {};
  }

  const answerSystem = `You are lemap's enterprise semantic query reasoner. Answer from the gathered semantic-map evidence only. First respect the classified intent. For data analytics, construct the smallest useful combined data view: identify fact-like records/events, dimensions, measures, joins/relations, and filters. It is valid to derive sales from fulfilled/placed order and order-item evidence rather than a literal Sales entity. Region may come through address/contact/geography evidence. For web analytics, connect behavioral/search/click/session workflows to conversion/order workflows when evidenced, and clearly flag missing instrumentation or workflows. For operations/support/engineering, use the relevant workflows, entities, fields and relations rather than forcing an analytical view. Never invent actual historical values or fields that were not found. Clearly distinguish grounded evidence from missing evidence. Return strict JSON: {"intent":"","answer":"","workflowsUsed":[{"id":"","title":"","role":""}],"relevantEntities":[],"relevantRelationships":[],"candidateView":{"purpose":"","factGrain":"","entities":[],"joins":[],"dimensions":[],"measures":[],"filters":[],"missing":[]},"scenarios":[{"scenario":"","why":"","dataToCheck":[]}],"missingEvidence":[],"nextStep":""}.`;
  const answerUser = `QUESTION ${JSON.stringify(question)}\nCLASSIFICATION ${JSON.stringify({ intent: plan.intent || first.parsed?.intent || '', reason: plan.reason || first.parsed?.reason || '' })}\nTOP_LEVEL_WORKFLOWS ${JSON.stringify(workflows)}\nTOP_LEVEL_ENTITIES ${JSON.stringify(entities)}\nTOOL_RESULTS ${JSON.stringify(observations)}\nUNLEARNED_PATH_HINTS ${JSON.stringify(pathHints.slice(0, 6))}`;
  const answer = await clientCall(answerSystem, answerUser, 1700); addUsage(answer.usage); log('investigator_answer', { prompt: answerUser, response: answer.parsed, usage: answer.usage });
  return { ...answer.parsed, investigation: { toolRequests: observations.map((o) => ({ tool: o.tool, args: o.args })), rounds: Math.min(3, 1 + observations.length), usage } };
}
