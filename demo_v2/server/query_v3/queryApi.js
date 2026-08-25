import fs from 'node:fs';
import path from 'node:path';
import { graphFromSemanticObjects } from '../explorer/mapPersistence.js';
import { loadEntityDirectory } from '../entityDirectory.js';
import { runSemanticBestFirstQuery } from './queryEngine.js';

export function registerQueryV3Api({ app, explorer, queryClient, queryModel, dataRoot, onLatestLog = () => {} }) {
  const queryRunPath = () => {
    const dir = path.join(dataRoot, 'query-runs-v3');
    fs.mkdirSync(dir, { recursive:true });
    return path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  };
  const append = (file, type, payload = {}) => fs.appendFileSync(file, `${JSON.stringify({ type, timestamp:new Date().toISOString(), ...payload })}\n`, 'utf8');

  app.post('/api/query-map-v3', async (req, res) => {
    const queryLog = queryRunPath();
    onLatestLog(queryLog);
    try {
      if (!queryClient) return res.status(503).json({ error:'The reasoning service is not configured' });
      const question = String(req.body?.question || '').trim();
      if (!question) return res.status(400).json({ error:'question is required' });

      const snapshot = explorer.snapshot();
      const graph = graphFromSemanticObjects(snapshot.semanticObjects || {});
      const entityCount = graph.filter((node) => node?.type === 'entity').length;
      if (!entityCount) return res.status(409).json({ error:'The semantic graph has no entities yet' });
      const { directory, file } = loadEntityDirectory({ dataRoot, repoUrl:snapshot.repoUrl || '' });
      if (!directory?.groups?.length) return res.status(409).json({ error:'The entity directory is not ready yet.' });

      console.log(`\n[lemap query-v3] ${question}`);
      console.log(`[lemap query-v3] semantic best-first state search over ${directory.groups.length} clusters and ${entityCount} entities`);
      append(queryLog, 'query_v3_start', {
        question,
        repoUrl:snapshot.repoUrl || '',
        commit:snapshot.commit || '',
        graphEntityCount:entityCount,
        directoryFile:file,
        directoryGroupCount:directory.groups.length,
        mode:'semantic-best-first-state-search-v3'
      });

      const response = await runSemanticBestFirstQuery({
        question,
        client:queryClient,
        model:queryModel,
        graph,
        directory,
        log:(type, payload) => append(queryLog, type, payload)
      });
      append(queryLog, 'query_v3_complete', { question, response, cumulativeUsage:response?.investigation?.usage || {} });
      return res.json(response);
    } catch (error) {
      append(queryLog, 'query_v3_error', { error:error.message || String(error) });
      console.error(`[lemap query-v3] ${error.message || error}`);
      return res.status(500).json({ error:error.message || 'Query v3 failed' });
    }
  });
}
