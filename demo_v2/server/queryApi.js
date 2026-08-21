import fs from 'node:fs';
import path from 'node:path';
import { investigateQuery } from './queryInvestigatorV2.js';

const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 220) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);

function normalizedUsage(usage = {}) {
  return {
    prompt: Number(usage.prompt || 0), completion: Number(usage.completion || 0), total: Number(usage.total || 0),
    cacheHit: Number(usage.cacheHit || 0), cacheMiss: Number(usage.cacheMiss || 0)
  };
}

function compactFinalEvidence(messages = []) {
  const last = messages[messages.length - 1]?.content || '';
  const marker = 'FINALIZED_EVIDENCE\n';
  const index = last.indexOf(marker);
  if (index < 0) return last.slice(0, 7000);
  try {
    const packet = JSON.parse(last.slice(index + marker.length));
    const fields = arr(packet.fields).map((group) => ({
      entity: group.entity,
      fields: arr(group.fields).slice(0, 18).map((f) => ({
        entity: f.entity || group.entity,
        name: f.name,
        type: f.type,
        description: clean(f.description, 100),
        isPk: !!f.isPk
      }))
    }));
    const compact = {
      question: packet.question,
      workflows: arr(packet.workflows).slice(0, 6).map((w) => ({ id: w.id, name: w.name || w.title, description: clean(w.description, 110), state: w.state })),
      entities: arr(packet.entities).slice(0, 10).map((e) => ({ name: e.name, description: clean(e.description, 100), fieldCount: e.fieldCount })),
      fields,
      relations: arr(packet.relations).slice(0, 12).map((r) => ({ from: r.from, relation: r.relation, to: r.to, description: clean(r.description, 100) })),
      gaps: arr(packet.gaps).slice(0, 6)
    };
    return `QUESTION\n${packet.question || ''}\n\nFINALIZED_EVIDENCE\n${JSON.stringify(compact)}`;
  } catch {
    return last.slice(0, 7000);
  }
}

function compactingClient(client) {
  return {
    chat: {
      completions: {
        create: async (request) => {
          if (!request?.response_format) return client.chat.completions.create(request);
          const system = `Answer the business question from the supplied semantic evidence only. Be concise. Return valid JSON with exactly: {"intent":"data_analytics|web_analytics|operations|support|decision_support|engineering|other","answer":"2-5 sentence human answer","dataView":null or {"grain":"","select":[{"entity":"","field":"","alias":"","role":"key|measure|dimension|time|attribute"}],"joins":[{"left":"","right":"","relation":"","evidenced":true}],"filters":[],"groupBy":[],"orderBy":[],"missing":[]},"nextStep":""}. For analytics, use only fields present in evidence. If a join is plausible but exact keys are absent, keep it but set evidenced=false. Keep the entire response compact.`;
          return client.chat.completions.create({
            ...request,
            messages: [{ role: 'system', content: system }, { role: 'user', content: compactFinalEvidence(request.messages || []) }],
            max_tokens: 650,
            temperature: 0.1
          });
        }
      }
    }
  };
}

function fallbackFromMap(question, arcs = []) {
  const fieldGroups = [];
  const seen = new Set();
  for (const arc of arcs) for (const detail of arr(arc.entityDetails)) {
    const fields = arr(detail.fields);
    if (!fields.length) continue;
    const entity = String(detail.name || '');
    const scored = fields.filter((f) => /product|quantity|amount|total|price|region|state|country|geo|postal|date|status|orderid/i.test(`${f.name || ''} ${f.description || ''}`)).slice(0, 8);
    if (!scored.length || seen.has(entity.toLowerCase())) continue;
    seen.add(entity.toLowerCase()); fieldGroups.push({ entity, fields: scored });
  }
  const select = [];
  const add = (entity, f, role) => { if (f && !select.some((x) => x.entity === entity && x.field === f.name)) select.push({ entity, field: f.name, alias: '', role }); };
  for (const group of fieldGroups) {
    const product = group.fields.find((f) => /productid/i.test(f.name || ''));
    const qty = group.fields.find((f) => /^quantity$/i.test(f.name || ''));
    const amount = group.fields.find((f) => /unitamount|grandtotal|parttotal|totalamount|amount/i.test(f.name || ''));
    const region = group.fields.find((f) => /stategeoname|region|state|province|country|geo/i.test(`${f.name || ''} ${f.description || ''}`));
    const date = group.fields.find((f) => /placeddate|completeddate|entrydate|date/i.test(f.name || ''));
    add(group.entity, product, 'dimension'); add(group.entity, qty, 'measure'); add(group.entity, amount, 'measure'); add(group.entity, region, 'dimension'); add(group.entity, date, 'time');
  }
  const names = select.map((x) => `${x.entity}.${x.field}`);
  const missing = [];
  if (!select.some((x) => x.role === 'dimension' && /product/i.test(x.field))) missing.push('Product identifier field was not established.');
  if (!select.some((x) => x.role === 'dimension' && /region|state|country|geo/i.test(x.field))) missing.push('Region/address field was not established.');
  if (!select.some((x) => x.role === 'measure')) missing.push('Sales quantity/amount field was not established.');
  return {
    intent: 'data_analytics',
    answer: names.length ? `The map found fields that can form a product-sales view, but the model did not complete its formatted answer. The evidenced candidate fields are ${names.slice(0, 8).join(', ')}.${missing.length ? ` ${missing.join(' ')}` : ''}` : 'The map investigation completed, but it did not produce enough field-level evidence to construct the view.',
    dataView: { grain: 'order item / product sale', select, joins: [], filters: [], groupBy: select.filter((x) => x.role === 'dimension').map((x) => `${x.entity}.${x.field}`), orderBy: select.filter((x) => x.role === 'measure').slice(0, 1).map((x) => ({ field: `${x.entity}.${x.field}`, direction: 'desc' })), missing },
    nextStep: missing.length ? 'Learn or inspect the missing relationship/fields before executing the view.' : ''
  };
}

function uiProjection(response = {}) {
  const view = response.dataView || null;
  if (!view) return response;
  const selected = arr(view.select), joins = arr(view.joins), filters = arr(view.filters), groupBy = arr(view.groupBy), orderBy = arr(view.orderBy);
  const relevantEntities = [...new Set(selected.map((item) => item?.entity).filter(Boolean))];
  const fields = selected.map((item) => `${item.entity}.${item.field}${item.alias ? ` as ${item.alias}` : ''}${item.role ? ` (${item.role})` : ''}`);
  const joinText = joins.map((item) => `${item.left} → ${item.right}${item.relation ? ` via ${item.relation}` : ''}${item.evidenced === false ? ' [join not yet evidenced]' : ''}`);
  const filterText = filters.map((item) => typeof item === 'string' ? item : `${item.field || ''}: ${item.condition || ''}${item.evidenced === false ? ' [not yet evidenced]' : ''}`);
  const shaping = [groupBy.length ? `Group by: ${groupBy.join(', ')}` : '', orderBy.length ? `Order by: ${orderBy.map((item) => typeof item === 'string' ? item : `${item.field} ${item.direction || ''}`.trim()).join(', ')}` : ''].filter(Boolean).join(' · ');
  const scenarios = [];
  if (view.grain) scenarios.push({ scenario: 'Data view grain', why: view.grain });
  if (fields.length) scenarios.push({ scenario: 'Fields in the proposed data view', why: fields.join(' · ') });
  if (joinText.length) scenarios.push({ scenario: 'Joins', why: joinText.join(' · ') });
  if (filterText.length || shaping) scenarios.push({ scenario: 'Filters and shaping', why: [...filterText, shaping].filter(Boolean).join(' · ') });
  if (arr(view.missing).length) scenarios.push({ scenario: 'Still missing', why: view.missing.join(' · ') });
  return { ...response, relevantEntities, scenarios };
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
