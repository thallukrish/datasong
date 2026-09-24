import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { graphFromSemanticObjects } from '../explorer/mapPersistence.js';
import { loadEntityDirectory } from '../entityDirectory.js';
import { runSemanticBestFirstQueryV4 } from './queryEngine.js';
import { createQueryLearningOrchestrator } from './queryLearningOrchestrator.js';

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
  const dataView = response?.dataView || null;
  const select = arr(dataView?.select);
  const joins = arr(dataView?.joins);
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
    ...(arr(dataView?.missing).length ? [{ scenario:'Still missing', why:arr(dataView.missing).join(' · ') }] : [])
  ];

  return {
    answer:response?.answer || '',
    status:response?.status || 'answered',
    learningRequest:response?.learningRequest || null,
    stepAssessment:response?.stepAssessment || [],
    learningState:response?.learningState || null,
    investigation:response?.status === 'needs_learning' ? { complete:false, missingDimensions:response?.learningRequest?.missingDimensions || [] } : undefined,
    dataView,
    relevantEntities,
    scenarios,
    nextStep:response?.nextStep || '',
    queryPlan:response?.queryPlan || null
  };
}

export function registerQueryV4Api({ app, explorer, queryClient, queryModel, dataRoot, onLatestLog = () => {} }) {
  const pendingPlans = new Map();
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
      const phase = String(req.body?.phase || 'plan');
      const pendingId = String(req.body?.planId || '');
      const pending = phase === 'explore' ? pendingPlans.get(pendingId) : null;
      if (phase === 'explore' && !pending) return res.status(409).json({ error:'This plan is no longer available. Generate and review a new plan.' });
      if (!['plan','explore'].includes(phase)) return res.status(400).json({ error:'Invalid query phase' });
      if (!question) return res.status(400).json({ error:'question is required' });

      // Plan review needs only the already-learned workflow overview and the profile.
      // Do not block it on schema catalog repair, entity-directory generation,
      // or the subsequent workflow graph exploration.
      if (phase === 'plan') {
        const snapshot = explorer.snapshot();
        const workflows = arr(snapshot?.pass1Arcs).filter(isBusinessWorkflow);
        const normalizeRepo = (value) => String(value || '').trim().replace(/\/$/, '').toLowerCase();
        const matchingProfile = normalizeRepo(req.body?.repoUrl) === normalizeRepo(snapshot.repoUrl);
        const enterpriseContext = matchingProfile ? {
          name:String(req.body?.enterpriseName || '').slice(0,160),
          description:String(req.body?.enterpriseDescription || '').slice(0,3000)
        } : { name:'', description:'' };
        append(queryLog, 'query_v4_plan_start', { question, repoUrl:snapshot.repoUrl || '', workflowCount:workflows.length });
        console.log(`[lemap query-v4] preparing plan for: ${question} | workflows ${workflows.length}`);
        const plan = await runSemanticBestFirstQueryV4({
          question, client:queryClient, model:queryModel, workflows, enterpriseContext,
          planningOnly:true, planningGuidance:String(req.body?.planningGuidance || '').slice(0,2000),
          log:(type,payload)=>append(queryLog,type,payload)
        });
        const planId = randomUUID();
        if (pendingPlans.size >= 100) pendingPlans.delete(pendingPlans.keys().next().value);
        pendingPlans.set(planId, { question, repoUrl:snapshot.repoUrl, commit:snapshot.commit, queryPlan:plan.queryPlan });
        append(queryLog, 'query_v4_plan_ready', { question, planId, stepCount:arr(plan.queryPlan?.steps).length });
        console.log(`[lemap query-v4] plan ready | steps ${arr(plan.queryPlan?.steps).length}`);
        return res.json({ status:'plan_review', planId, queryPlan:plan.queryPlan });
      }

      // A persisted semantic map may have been loaded before the runtime source
      // schema catalog was prepared. Refresh/materialize it before taking the
      // immutable query snapshot so newly available framework/dependency edges
      // are queryable and are written back to the map on disk.
      const schemaRepair = typeof explorer.refreshSchemaCatalogForCurrentMap === 'function'
        ? await explorer.refreshSchemaCatalogForCurrentMap()
        : null;
      if (schemaRepair) append(queryLog, 'query_v4_schema_repair', schemaRepair);

      const snapshot = explorer.snapshot();
      const graph = graphFromSemanticObjects(snapshot.semanticObjects || {});
      const entityCount = graph.filter((node) => node?.type === 'entity').length;
      if (!entityCount) return res.json(uiProjection({ status:'needs_learning', nextStep:'No learned entities exist; targeted learning is required.', learningRequest:{ version:1, status:'needs_learning', question, grain:'', plan:[], targets:[{ stepId:'BOOTSTRAP', action:'Discover the initial query-relevant workflow and entities', objective:question, missingConcepts:[], knownEntityRefs:[] }], evidenceRefs:[], missingDimensions:[] } }));
      const { directory, file } = loadEntityDirectory({ dataRoot, repoUrl:snapshot.repoUrl || '' });
      if (!directory?.groups?.length) return res.json(uiProjection({ status:'needs_learning', nextStep:'The entity directory is unavailable; targeted learning is required.', learningRequest:{ version:1, status:'needs_learning', question, grain:'', plan:[], targets:[{ stepId:'BOOTSTRAP', action:'Discover and index query-relevant entity relationships', objective:question, missingConcepts:[], knownEntityRefs:[] }], evidenceRefs:[], missingDimensions:[] } }));
      const workflows = arr(snapshot?.pass1Arcs).filter(isBusinessWorkflow);
      // Only use the profile for the repository currently loaded on the server.
      const normalizeRepo = (value) => String(value || '').trim().replace(/\/$/, '').toLowerCase();
      const matchingProfile = normalizeRepo(req.body?.repoUrl) === normalizeRepo(snapshot.repoUrl);
      const enterpriseContext = matchingProfile ? {
        name:String(req.body?.enterpriseName || '').slice(0,160),
        description:String(req.body?.enterpriseDescription || '').slice(0,3000)
      } : { name:'', description:'' };

      if (pending && (pending.question !== question || pending.repoUrl !== snapshot.repoUrl || pending.commit !== snapshot.commit)) {
        return res.status(409).json({ error:'Question or enterprise map changed. Generate and review a new plan.' });
      }
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

      const orchestrate = createQueryLearningOrchestrator({
        // Query V4 continues to own the plan and evidence assessment. A targeted
        // adapter learner must be registered before autoLearn can execute.
        runQuery:({question:currentQuestion}) => runSemanticBestFirstQueryV4({
          question:currentQuestion, client:queryClient, model:queryModel, graph, directory, workflows, enterpriseContext,
          planningOnly:phase === 'plan', approvedPlan:pending?.queryPlan || null,
          planningGuidance:phase === 'plan' ? String(req.body?.planningGuidance || '').slice(0,2000) : '',
          log:(type,payload)=>append(queryLog,type,payload)
        }),
        log:(type,payload)=>append(queryLog,type,payload)
      });
      const rawResponse = await orchestrate({question, autoLearn:phase === 'explore' && req.body?.autoLearn === true});
      if (phase === 'plan' && rawResponse.status === 'plan_review') {
        const planId = randomUUID();
        // Bound review sessions: no exploration occurs until an explicit approval request.
        if (pendingPlans.size >= 100) pendingPlans.delete(pendingPlans.keys().next().value);
        pendingPlans.set(planId, { question, repoUrl:snapshot.repoUrl, commit:snapshot.commit, queryPlan:rawResponse.queryPlan });
        return res.json({ status:'plan_review', planId, queryPlan:rawResponse.queryPlan });
      }
      if (phase === 'explore') pendingPlans.delete(pendingId);

      append(queryLog, 'query_v4_complete', {
        question,
        response:rawResponse,
        cumulativeUsage:rawResponse?.investigation?.usage || {}
      });

      const response = uiProjection(rawResponse);
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
