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

function removeExistingPostRoute(app, routePath) {
  const stack = app?.router?.stack || app?._router?.stack;
  if (!Array.isArray(stack)) return false;
  let removed = false;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const route = stack[index]?.route;
    if (route?.path === routePath && route?.methods?.post) {
      stack.splice(index, 1);
      removed = true;
    }
  }
  return removed;
}

function uiProjection(response = {}) {
  const select = arr(response?.dataView?.select);
  const joins = arr(response?.dataView?.joins);
  const relevantEntities = [...new Set(select.map((item) => item?.entity).filter(Boolean))];
  const mapping = select.map((item) => ({
    scenario:item?.role || 'mapping',
    why:[item?.entity, item?.field].filter(Boolean).join('.')
  }));
  const joinText = joins.map((join) => {
    const relation = join?.relation ? ` (${join.relation})` : '';
    return `${join?.left || ''} → ${join?.right || ''}${relation}`;
  }).filter(Boolean);
  const scenarios = [
    ...mapping,
    ...(joinText.length ? [{ scenario:'How the entities connect', why:joinText.join(' · ') }] : []),
    ...(arr(response?.dataView?.missing).length ? [{ scenario:'Still missing', why:arr(response.dataView.missing).join(' · ') }] : [])
  ];
  return { ...response, relevantEntities, scenarios };
}

export function registerQueryV4Api({ app, explorer, queryClient, queryModel, dataRoot, onLatestLog = () => {} }) {
  const queryRunPath = () => {
    const dir = path.join(dataRoot, 'query-runs-v4');
    fs.mkdirSync(dir, { recursive:true });
    return path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  };
  const append = (file, type, payload = {}) => fs.appendFileSync(file, `${JSON.stringify({ type, timestamp:new Date().toISOString(), ...payload })}\n`, 'utf8');

  const handleQueryV4 = async (req, res) => {
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
      console.log(`[lemap query-v4] workflow-first semantic search over ${workflows.length} workflows and ${entityCount} entities`);
      append(queryLog, 'query_v4_start', {
        question,
        repoUrl:snapshot.repoUrl || '',
        commit:snapshot.commit || '',
        graphEntityCount:entityCount,
        workflowCount:workflows.length,
        directoryFile:file,
        directoryGroupCount:directory.groups.length,
        mode:'semantic-best-first-workflow-first-v4'
      });

      const rawResponse = await runSemanticBestFirstQueryV4({
        question,
        client:queryClient,
        model:queryModel,
        graph,
        directory,
        workflows,
        log:(type, payload) => append(queryLog, type, payload)
      });
      const response = uiProjection(rawResponse);
      append(queryLog, 'query_v4_complete', { question, response, cumulativeUsage:response?.investigation?.usage || {} });
      return res.json(response);
    } catch (error) {
      append(queryLog, 'query_v4_error', { error:error.message || String(error) });
      console.error(`[lemap query-v4] ${error.message || error}`);
      return res.status(500).json({ error:error.message || 'Query v4 failed' });
    }
  };

  app.post('/api/query-map-v4', handleQueryV4);

  const replacedLegacyRoute = removeExistingPostRoute(app, '/api/query-map');
  app.post('/api/query-map', handleQueryV4);
  console.log(`[DataSong v2] QUERY UI: /api/query-map → v4${replacedLegacyRoute ? ' (legacy route replaced)' : ''}`);
}
