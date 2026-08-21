import fs from 'node:fs';
import path from 'node:path';
import { investigateQuery } from './queryInvestigatorV2.js';

function normalizedUsage(usage = {}) {
  return {
    prompt: Number(usage.prompt || 0), completion: Number(usage.completion || 0), total: Number(usage.total || 0),
    cacheHit: Number(usage.cacheHit || 0), cacheMiss: Number(usage.cacheMiss || 0)
  };
}

function uiProjection(response = {}) {
  const view = response.dataView || null;
  if (!view) return response;
  const selected = Array.isArray(view.select) ? view.select : [];
  const joins = Array.isArray(view.joins) ? view.joins : [];
  const filters = Array.isArray(view.filters) ? view.filters : [];
  const groupBy = Array.isArray(view.groupBy) ? view.groupBy : [];
  const orderBy = Array.isArray(view.orderBy) ? view.orderBy : [];
  const relevantEntities = [...new Set(selected.map((item) => item?.entity).filter(Boolean))];
  const fields = selected.map((item) => `${item.entity}.${item.field}${item.alias ? ` as ${item.alias}` : ''}${item.role ? ` (${item.role})` : ''}`);
  const joinText = joins.map((item) => `${item.left} → ${item.right}${item.relation ? ` via ${item.relation}` : ''}${item.evidenced === false ? ' [join not yet evidenced]' : ''}`);
  const filterText = filters.map((item) => `${item.field}: ${item.condition}${item.evidenced === false ? ' [not yet evidenced]' : ''}`);
  const shaping = [groupBy.length ? `Group by: ${groupBy.join(', ')}` : '', orderBy.length ? `Order by: ${orderBy.map((item) => `${item.field} ${item.direction || ''}`.trim()).join(', ')}` : ''].filter(Boolean).join(' · ');
  const scenarios = [];
  if (fields.length) scenarios.push({ scenario: 'Fields in the proposed data view', why: fields.join(' · ') });
  if (joinText.length) scenarios.push({ scenario: 'Joins', why: joinText.join(' · ') });
  if (filterText.length || shaping) scenarios.push({ scenario: 'Filters and shaping', why: [...filterText, shaping].filter(Boolean).join(' · ') });
  if (Array.isArray(view.missing) && view.missing.length) scenarios.push({ scenario: 'Still missing', why: view.missing.join(' · ') });
  return { ...response, relevantEntities, scenarios };
}

export function registerQueryApi({ app, explorer, queryClient, queryModel, dataRoot, businessArcs, mapStateForArc, relevantPathHints, onLatestLog = () => {} }) {
  const queryRunPath = () => {
    const dir = path.join(dataRoot, 'query-runs'); fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  };
  const append = (file, type, payload = {}) => fs.appendFileSync(file, `${JSON.stringify({ type, timestamp: new Date().toISOString(), ...payload })}\n`, 'utf8');

  app.post('/api/query-map', async (req, res) => {
    const queryLog = queryRunPath(); onLatestLog(queryLog);
    try {
      if (!queryClient) return res.status(503).json({ error: 'The reasoning service is not configured' });
      const question = String(req.body?.question || '').trim();
      if (!question) return res.status(400).json({ error: 'question is required' });

      explorer.persistSemanticMap?.();
      const snapshot = explorer.snapshot();
      const arcs = businessArcs(snapshot);
      if (!arcs.length && !relevantPathHints(question, 8).length) {
        return res.status(409).json({ error: 'The enterprise map has not identified anything relevant to this question yet' });
      }

      append(queryLog, 'query_start', { question, repoUrl: snapshot.repoUrl || '', commit: snapshot.commit || '', workflowCount: arcs.length });
      const rawResponse = await investigateQuery({
        question,
        client: queryClient,
        model: queryModel,
        arcs,
        snapshot,
        mapStateForArc,
        pathHints: (query) => relevantPathHints(query, 8),
        log: (type, payload) => append(queryLog, type, payload)
      });
      const response = uiProjection(rawResponse);
      append(queryLog, 'query_complete', { question, response, cumulativeUsage: normalizedUsage(response?.investigation?.usage || {}) });
      console.log(`[lemap query-agent] tokens ${response?.investigation?.usage?.total || 0} — ${question}`);
      return res.json(response);
    } catch (error) {
      append(queryLog, 'query_error', { error: error.message || String(error) });
      console.error(`[lemap query-agent] ${error.message}`);
      return res.status(500).json({ error: error.message || 'Query failed' });
    }
  });
}
