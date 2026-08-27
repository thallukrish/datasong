import fs from 'node:fs';
import path from 'node:path';
import { graphFromSemanticObjects } from '../explorer/mapPersistence.js';
import { loadEntityDirectory } from '../entityDirectory.js';
import { runSemanticBestFirstQueryV4 } from './queryEngine.js';

const arr = (value) => Array.isArray(value) ? value : [];

function isBusinessWorkflow(workflow) {
  const marks = [workflow?.classification, workflow?.qualification, workflow?.pathNature, workflow?.evidenceClassification]
    .map((value) => String(value || '').toLowerCase());
  if (marks.some((value) => value === 'technical' || value === 'technical_flow' || value.includes('not_business'))) return false;
  if (workflow?.qualifiesAsBusinessUseCase === false) return false;
  return true;
}

export function registerQueryV4Api({ app, explorer, queryClient, queryModel, dataRoot, onLatestLog = () => {} }) {
  const queryRunPath = () => {
    const dir = path.join(dataRoot, 'query-runs-v4');
    fs.mkdirSync(dir, { recursive:true });
    return path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  };
  const append = (file, type, payload = {}) => fs.appendFileSync(file, `${JSON.stringify({ type, timestamp:new Date().toISOString(), ...payload })}\n`, 'utf8');

  app.post('/api/query-map-v4', async (req, res) => {
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
      const workflows = arr(snapshot?.pass1Arcs).filter(isBusinessWorkflow);

      console.log(`\n[lemap query-v4] ${question}`);
      console.log(`[lemap query-v4] parallel workflow + directory seeding over ${workflows.length} workflows, ${directory.groups.length} clusters and ${entityCount} entities`);
      append(queryLog, 'query_v4_start', {
        question,
        repoUrl:snapshot.repoUrl || '',
        commit:snapshot.commit || '',
        graphEntityCount:entityCount,
        workflowCount:workflows.length,
        directoryFile:file,
        directoryGroupCount:directory.groups.length,
        mode:'semantic-best-first-parallel-workflow-directory-v4'
      });

      const response = await runSemanticBestFirstQueryV4({
        question,
        client:queryClient,
        model:queryModel,
        graph,
        directory,
        workflows,
        log:(type, payload) => append(queryLog, type, payload)
      });
      append(queryLog, 'query_v4_complete', { question, response, cumulativeUsage:response?.investigation?.usage || {} });
      return res.json(response);
    } catch (error) {
      append(queryLog, 'query_v4_error', { error:error.message || String(error) });
      console.error(`[lemap query-v4] ${error.message || error}`);
      return res.status(500).json({ error:error.message || 'Query v4 failed' });
    }
  });
}
