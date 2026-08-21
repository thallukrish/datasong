import fs from 'node:fs';
import path from 'node:path';
import { investigateQuery } from './queryGuidedInvestigator.js';

const arr = (value) => Array.isArray(value) ? value : [];
const key = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function normalizedUsage(usage = {}) {
  return { prompt:Number(usage.prompt || 0), completion:Number(usage.completion || 0), total:Number(usage.total || 0) };
}

function friendlyEntity(name) {
  const value = String(name || '').trim();
  if (!value || value.length > 70 || /[.#/:()]/.test(value)) return false;
  if (/\b(service|services|record|records|result|results|output|retrieved|read\/updated|created)\b/i.test(value)) return false;
  return /^[A-Za-z][A-Za-z0-9 _-]*$/.test(value);
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
    select:selected,
    joins,
    filters:arr(view.filters).slice(0,4),
    groupBy:arr(view.groupBy).slice(0,4),
    orderBy:arr(view.orderBy).slice(0,2),
    missing:arr(view.missing).slice(0,4)
  };
}

function fallbackFromInvestigation(question, investigation = {}) {
  const entities = arr(investigation.selectedEntities).filter(friendlyEntity).slice(0,5);
  return {
    intent:'data_analytics',
    answer: entities.length
      ? `The guided map walk identified ${entities.join(', ')} as the relevant semantic area, but the final field-level view was not completed. The map should be inspected further only for the missing join/field evidence.`
      : 'The guided map walk did not produce enough field-level evidence to construct a reliable view.',
    dataView:null,
    nextStep:'Inspect the query log for the scope, plan, and connection stages.'
  };
}

function uiProjection(response = {}) {
  const view = response.dataView ? sanitizeView(response.dataView) : null;
  if (!view) return response;
  const selected = arr(view.select);
  const relevantEntities = [...new Set(selected.map((item) => item.entity))];
  const fieldsByEntity = relevantEntities.map((entity) => ({
    entity,
    fields:selected.filter((x) => x.entity === entity).map((x) => `${x.field}${x.alias ? ` as ${x.alias}` : ''}${x.role ? ` (${x.role})` : ''}`)
  }));
  const joinText = arr(view.joins).map((j) => `${j.left} → ${j.right}${j.relation ? ` (${j.relation})` : ''}${j.evidenced === false ? ' — exact join columns not yet evidenced' : ''}`);
  const shape = [];
  if (arr(view.groupBy).length) shape.push(`Group by ${view.groupBy.join(' + ')}`);
  if (arr(view.orderBy).length) shape.push(`Rank/order by ${view.orderBy.map((o) => `${o.field} ${o.direction || ''}`.trim()).join(', ')}`);
  const scenarios = [
    ...(view.grain ? [{scenario:'Data view grain',why:view.grain}] : []),
    ...fieldsByEntity.map((g) => ({scenario:g.entity,why:g.fields.join(' · ')})),
    ...(joinText.length ? [{scenario:'How the entities connect',why:joinText.join(' · ')}] : []),
    ...(shape.length ? [{scenario:'How to answer the question',why:shape.join(' · ')}] : []),
    ...(arr(view.missing).length ? [{scenario:'Still missing',why:view.missing.join(' · ')}] : [])
  ];
  return { ...response, dataView:view, relevantEntities, scenarios };
}

export function registerQueryApi({ app, explorer, queryClient, queryModel, dataRoot, businessArcs, mapStateForArc, relevantPathHints, onLatestLog = () => {} }) {
  const queryRunPath = () => {
    const dir = path.join(dataRoot, 'query-runs'); fs.mkdirSync(dir, { recursive:true });
    return path.join(dir, `${new Date().toISOString().replace(/[:.]/g,'-')}.jsonl`);
  };
  const append = (file, type, payload = {}) => fs.appendFileSync(file, `${JSON.stringify({type,timestamp:new Date().toISOString(),...payload})}\n`, 'utf8');

  app.post('/api/query-map', async (req, res) => {
    const queryLog = queryRunPath(); onLatestLog(queryLog);
    try {
      if (!queryClient) return res.status(503).json({error:'The reasoning service is not configured'});
      const question = String(req.body?.question || '').trim();
      if (!question) return res.status(400).json({error:'question is required'});

      explorer.persistSemanticMap?.();
      const snapshot = explorer.snapshot();
      const arcs = businessArcs(snapshot);
      if (!arcs.length && !relevantPathHints(question,8).length) return res.status(409).json({error:'The enterprise map has not identified anything relevant to this question yet'});

      append(queryLog,'query_start',{question,repoUrl:snapshot.repoUrl || '',commit:snapshot.commit || '',workflowCount:arcs.length,mode:'guided'});
      let rawResponse = await investigateQuery({
        question,
        client:queryClient,
        model:queryModel,
        arcs,
        snapshot,
        mapStateForArc,
        pathHints:(query) => relevantPathHints(query,8),
        log:(type,payload) => append(queryLog,type,payload)
      });
      if (!rawResponse?.answer) {
        const fallback = fallbackFromInvestigation(question, rawResponse?.investigation || {});
        rawResponse = { ...fallback, investigation:rawResponse?.investigation || {} };
        append(queryLog,'query_fallback',{reason:'empty_final_guided_answer',fallback});
      }
      const response = uiProjection(rawResponse);
      append(queryLog,'query_complete',{question,response,cumulativeUsage:normalizedUsage(response?.investigation?.usage || {})});
      console.log(`[lemap query-guided] tokens ${response?.investigation?.usage?.total || 0} — ${question}`);
      return res.json(response);
    } catch (error) {
      append(queryLog,'query_error',{error:error.message || String(error)});
      console.error(`[lemap query-guided] ${error.message}`);
      return res.status(500).json({error:error.message || 'Query failed'});
    }
  });
}
