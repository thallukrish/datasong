import fs from 'node:fs';
import path from 'node:path';
import { investigateQuery } from './queryInvestigatorV2.js';

const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 220) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const key = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function normalizedUsage(usage = {}) {
  return {
    prompt: Number(usage.prompt || 0), completion: Number(usage.completion || 0), total: Number(usage.total || 0),
    cacheHit: Number(usage.cacheHit || 0), cacheMiss: Number(usage.cacheMiss || 0)
  };
}

function friendlyEntity(name) {
  const value = String(name || '').trim();
  if (!value || value.length > 70) return false;
  if (/[.#/:()]/.test(value)) return false;
  if (/\b(service|services|record|records|result|results|output|retrieved|read\/updated|created)\b/i.test(value)) return false;
  return /^[A-Za-z][A-Za-z0-9 _-]*$/.test(value);
}

function fieldRole(field) {
  const text = `${field?.name || ''} ${field?.description || ''}`.toLowerCase();
  if (/product(id| identifier| sku)/.test(text)) return 'product';
  if (/quantity|qty|units sold/.test(text)) return 'quantity';
  if (/grandtotal|parttotal|unitamount|sales amount|revenue|price|total amount/.test(text)) return 'amount';
  if (/stategeoname|region|province|state name|country|geo name/.test(text)) return 'region';
  if (/placeddate|orderdate|completeddate|entrydate|createddate|date time|datetime/.test(text)) return 'time';
  if (/orderid/.test(text)) return 'orderKey';
  if (/status/.test(text)) return 'status';
  return '';
}

function semanticFieldGroups(arcs = []) {
  const groups = new Map();
  for (const arc of arcs) for (const detail of arr(arc.entityDetails)) {
    const entity = String(detail?.name || '').trim();
    if (!friendlyEntity(entity)) continue;
    const fields = arr(detail?.fields).filter((f) => f?.name);
    if (!fields.length) continue;
    const existing = groups.get(key(entity)) || { entity, fields: [] };
    for (const field of fields) if (!existing.fields.some((x) => key(x.name) === key(field.name))) existing.fields.push(field);
    groups.set(key(entity), existing);
  }
  return [...groups.values()];
}

function bestField(groups, roles, preferredEntity = null) {
  const roleSet = new Set(arr(roles));
  const candidates = [];
  for (const group of groups) {
    for (const field of group.fields) {
      const role = fieldRole(field);
      if (!roleSet.has(role)) continue;
      let score = 1;
      if (preferredEntity && key(group.entity).includes(key(preferredEntity))) score += 3;
      if (field.authoritative === true) score += 1;
      if (field.isPk) score += 0.5;
      candidates.push({ entity: group.entity, field, role, score });
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function compactFinalEvidence(messages = []) {
  const last = messages[messages.length - 1]?.content || '';
  const marker = 'FINALIZED_EVIDENCE\n';
  const index = last.indexOf(marker);
  if (index < 0) return last.slice(0, 5600);
  try {
    const packet = JSON.parse(last.slice(index + marker.length));
    const groups = arr(packet.fields)
      .filter((group) => friendlyEntity(group.entity))
      .map((group) => ({
        entity: group.entity,
        fields: arr(group.fields).filter((f) => fieldRole(f)).slice(0, 10).map((f) => ({
          entity: f.entity || group.entity, name: f.name, role: fieldRole(f), type: f.type, description: clean(f.description, 80)
        }))
      })).filter((group) => group.fields.length).slice(0, 8);
    const compact = {
      question: packet.question,
      entities: groups.map((g) => g.entity),
      fields: groups,
      relations: arr(packet.relations).filter((r) => friendlyEntity(r.from) && friendlyEntity(r.to)).slice(0, 8).map((r) => ({ from: r.from, relation: r.relation, to: r.to })),
      gaps: arr(packet.gaps).slice(0, 4)
    };
    return `QUESTION\n${packet.question || ''}\n\nFINALIZED_EVIDENCE\n${JSON.stringify(compact)}`;
  } catch {
    return last.slice(0, 5600);
  }
}

function compactingClient(client) {
  return {
    chat: { completions: { create: async (request) => {
      if (!request?.response_format) return client.chat.completions.create(request);
      const system = `Build the smallest useful semantic data view that answers the question. Use only business/data entity names and exact fields supplied in evidence. Never expose service/function names, source paths, framework classes, or implementation identifiers. Prefer 3-5 entities and at most 8 selected fields. Explain how the selected entities relate and which fields join them. Return valid compact JSON exactly: {"intent":"data_analytics|web_analytics|operations|support|decision_support|engineering|other","answer":"2-4 sentence human answer","dataView":null or {"grain":"","select":[{"entity":"","field":"","alias":"","role":"key|measure|dimension|time|attribute"}],"joins":[{"left":"Entity.field or Entity","right":"Entity.field or Entity","relation":"","evidenced":true}],"filters":[],"groupBy":[],"orderBy":[],"missing":[]},"nextStep":""}. For analytics, every selected field must exist in evidence. If exact join columns are not established, use entity names in left/right and set evidenced=false rather than inventing keys.`;
      return client.chat.completions.create({
        ...request,
        messages: [{ role: 'system', content: system }, { role: 'user', content: compactFinalEvidence(request.messages || []) }],
        max_tokens: 520,
        temperature: 0.1
      });
    } } }
  };
}

function fallbackFromMap(question, arcs = []) {
  const groups = semanticFieldGroups(arcs);
  const product = bestField(groups, ['product'], 'OrderItem') || bestField(groups, ['product'], 'Product');
  const quantity = bestField(groups, ['quantity'], product?.entity || 'OrderItem');
  const amount = bestField(groups, ['amount'], product?.entity || 'OrderItem');
  const region = bestField(groups, ['region'], 'PostalAddress');
  const time = bestField(groups, ['time'], 'OrderHeader');
  const orderKey = bestField(groups, ['orderKey'], 'OrderHeader');
  const status = bestField(groups, ['status'], 'OrderHeader');

  const select = [];
  const add = (candidate, role, alias = '') => {
    if (!candidate || select.some((x) => key(x.entity) === key(candidate.entity) && key(x.field) === key(candidate.field.name))) return;
    select.push({ entity: candidate.entity, field: candidate.field.name, alias, role });
  };
  add(product, 'dimension', 'product');
  add(quantity, 'measure', 'quantity_sold');
  if (!quantity) add(amount, 'measure', 'sales_amount');
  add(region, 'dimension', 'region');
  add(time, 'time', 'order_date');
  add(orderKey, 'key', 'order_id');
  add(status, 'attribute', 'order_status');

  const missing = [];
  if (!product) missing.push('Product identifier field is not established.');
  if (!quantity && !amount) missing.push('Sales quantity/amount field is not established.');
  if (!region) missing.push('Region/address field is not established.');

  const entities = [...new Set(select.map((x) => x.entity))];
  const joins = [];
  if (product && region && key(product.entity) !== key(region.entity)) joins.push({ left: product.entity, right: region.entity, relation: 'through the order/customer shipping-address relationship', evidenced: false });

  const measure = quantity || amount;
  const answer = select.length
    ? `Use ${entities.join(', ')} to build the view. Group ${product ? `${product.entity}.${product.field.name}` : 'product'} by ${region ? `${region.entity}.${region.field.name}` : 'region'} and rank by ${measure ? `${measure.entity}.${measure.field.name}` : 'the sales measure'}. ${joins.length ? 'The exact join columns between the sales/order side and regional address side are not yet established in the map.' : ''}`
    : 'The map does not yet contain enough field-level evidence to construct this view.';

  return {
    intent: 'data_analytics', answer,
    dataView: {
      grain: 'one sold product / order item', select, joins,
      filters: time ? [{ field: `${time.entity}.${time.field.name}`, condition: 'requested time period', evidenced: true }] : [],
      groupBy: [product && `${product.entity}.${product.field.name}`, region && `${region.entity}.${region.field.name}`].filter(Boolean),
      orderBy: measure ? [{ field: `${measure.entity}.${measure.field.name}`, direction: 'desc' }] : [],
      missing
    },
    nextStep: missing.length || joins.some((j) => j.evidenced === false) ? 'Confirm the missing join/field evidence before executing this view.' : ''
  };
}

function sanitizeView(view = {}) {
  const selected = arr(view.select)
    .filter((x) => friendlyEntity(x?.entity) && x?.field)
    .filter((x, index, self) => self.findIndex((y) => key(y.entity) === key(x.entity) && key(y.field) === key(x.field)) === index)
    .slice(0, 8);
  const entitySet = new Set(selected.map((x) => key(x.entity)));
  const joins = arr(view.joins).filter((j) => {
    const leftEntity = String(j?.left || '').split('.')[0];
    const rightEntity = String(j?.right || '').split('.')[0];
    return friendlyEntity(leftEntity) && friendlyEntity(rightEntity) && (entitySet.has(key(leftEntity)) || entitySet.has(key(rightEntity)));
  }).slice(0, 5);
  return {
    ...view,
    select: selected,
    joins,
    filters: arr(view.filters).slice(0, 4),
    groupBy: arr(view.groupBy).filter((v) => !/[.#/:()]/.test(String(v || ''))).slice(0, 4),
    orderBy: arr(view.orderBy).slice(0, 2),
    missing: arr(view.missing).slice(0, 4)
  };
}

function uiProjection(response = {}) {
  const view = response.dataView ? sanitizeView(response.dataView) : null;
  if (!view) return response;
  const selected = arr(view.select);
  const relevantEntities = [...new Set(selected.map((item) => item.entity))];
  const fieldsByEntity = relevantEntities.map((entity) => ({
    entity,
    fields: selected.filter((x) => x.entity === entity).map((x) => `${x.field}${x.alias ? ` as ${x.alias}` : ''}${x.role ? ` (${x.role})` : ''}`)
  }));
  const joinText = arr(view.joins).map((j) => `${j.left} → ${j.right}${j.relation ? ` (${j.relation})` : ''}${j.evidenced === false ? ' — join columns not yet evidenced' : ''}`);
  const shape = [];
  if (arr(view.groupBy).length) shape.push(`Group by ${view.groupBy.join(' + ')}`);
  if (arr(view.orderBy).length) shape.push(`Rank/order by ${view.orderBy.map((o) => `${o.field} ${o.direction || ''}`.trim()).join(', ')}`);
  const scenarios = [
    ...(view.grain ? [{ scenario: 'Data view grain', why: view.grain }] : []),
    ...fieldsByEntity.map((g) => ({ scenario: g.entity, why: g.fields.join(' · ') })),
    ...(joinText.length ? [{ scenario: 'How the entities connect', why: joinText.join(' · ') }] : []),
    ...(shape.length ? [{ scenario: 'How to answer the question', why: shape.join(' · ') }] : []),
    ...(arr(view.missing).length ? [{ scenario: 'Still missing', why: view.missing.join(' · ') }] : [])
  ];
  return { ...response, dataView: view, relevantEntities, scenarios };
}

export function registerQueryApi({ app, explorer, queryClient, queryModel, dataRoot, businessArcs, mapStateForArc, relevantPathHints, onLatestLog = () => {} }) {
  const queryRunPath = () => { const dir = path.join(dataRoot, 'query-runs'); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`); };
  const append = (file, type, payload = {}) => fs.appendFileSync(file, `${JSON.stringify({ type, timestamp: new Date().toISOString(), ...payload })}\n`, 'utf8');

  app.post('/api/query-map', async (req, res) => {
    const queryLog = queryRunPath(); onLatestLog(queryLog);
    try {
      if (!queryClient) return res.status(503).json({ error: 'The reasoning service is not configured' });
      const question = String(req.body?.question || '').trim(); if (!question) return res.status(400).json({ error: 'question is required' });
      explorer.persistSemanticMap?.(); const snapshot = explorer.snapshot(); const arcs = businessArcs(snapshot);
      if (!arcs.length && !relevantPathHints(question, 8).length) return res.status(409).json({ error: 'The enterprise map has not identified anything relevant to this question yet' });
      append(queryLog, 'query_start', { question, repoUrl: snapshot.repoUrl || '', commit: snapshot.commit || '', workflowCount: arcs.length });
      let rawResponse = await investigateQuery({ question, client: compactingClient(queryClient), model: queryModel, arcs, snapshot, mapStateForArc, pathHints: (query) => relevantPathHints(query, 8), log: (type, payload) => append(queryLog, type, payload) });
      if (!rawResponse?.answer && !rawResponse?.dataView) {
        const fallback = fallbackFromMap(question, arcs);
        rawResponse = { ...fallback, investigation: rawResponse?.investigation || {} };
        append(queryLog, 'query_fallback', { reason: 'empty_or_unparseable_final_model_response', fallback });
      }
      const response = uiProjection(rawResponse);
      append(queryLog, 'query_complete', { question, response, cumulativeUsage: normalizedUsage(response?.investigation?.usage || {}) });
      console.log(`[lemap query-agent] tokens ${response?.investigation?.usage?.total || 0} — ${question}`);
      return res.json(response);
    } catch (error) {
      append(queryLog, 'query_error', { error: error.message || String(error) }); console.error(`[lemap query-agent] ${error.message}`); return res.status(500).json({ error: error.message || 'Query failed' });
    }
  });
}
