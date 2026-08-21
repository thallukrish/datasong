import fs from 'node:fs';
import path from 'node:path';
import { investigateQuery } from './queryInvestigatorV2.js';

function normalizedUsage(usage = {}) {
  return {
    prompt: Number(usage.prompt || 0), completion: Number(usage.completion || 0), total: Number(usage.total || 0),
    cacheHit: Number(usage.cacheHit || 0), cacheMiss: Number(usage.cacheMiss || 0)
  };
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
      const response = await investigateQuery({
        question,
        client: queryClient,
        model: queryModel,
        arcs,
        snapshot,
        mapStateForArc,
        pathHints: (query) => relevantPathHints(query, 8),
        log: (type, payload) => append(queryLog, type, payload)
      });
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
