import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { ProgressiveRepositoryTopologyV9 } from './progressiveRepositoryTopologyV9.js';
import { ProgressiveRepositoryExplorerV46 } from './progressiveRepositoryExplorerV46.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataRoot = path.join(root, 'data');
const app = express();
const port = Number(process.env.PORT || 3102);
const clients = new Set();

const topology = new ProgressiveRepositoryTopologyV9({ cacheRoot: path.join(dataRoot, 'repo-cache') });
const explorer = new ProgressiveRepositoryExplorerV46({ topology, dataRoot, onState: (state) => broadcast(state) });
const queryClient = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com', timeout: 60_000 })
  : null;
const queryModel = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
let running = false;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(root, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); }
}));
app.get('/api/state', (_req, res) => res.json(explorer.snapshot()));
app.get('/api/call-paths', (_req, res) => res.json({
  ready: !!topology.callPathIndex,
  xmlAdapter: topology.moquiXmlExecution,
  topPaths: topology.callPathIndex ? topology.topCallPaths(10) : []
}));
app.get('/api/run-log', (_req, res) => {
  if (!explorer.runLogPath) return res.status(404).json({ error: 'No run log is available yet' });
  return res.download(explorer.runLogPath, path.basename(explorer.runLogPath));
});
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);
  res.write(`data: ${JSON.stringify(explorer.snapshot())}\n\n`);
  req.on('close', () => clients.delete(res));
});
app.post('/api/explore', async (req, res) => {
  const repoUrl = String(req.body?.repoUrl || '').trim();
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });
  if (running) return res.status(409).json({ error: 'An exploration is already running' });
  running = true;
  res.status(202).json({ ok: true });
  explorer.run(repoUrl)
    .then((state) => console.log(`[DataSong v2] ${state.status} — ${state.lastMessage || 'exploration finished'}`))
    .catch((error) => {
      const state = explorer.snapshot();
      state.status = 'error';
      state.lastMessage = error.message;
      explorer.state = state;
      broadcast(state);
      console.error(`[DataSong v2] exploration failed: ${error.message}`);
    })
    .finally(() => { running = false; });
});
app.post('/api/stop', (_req, res) => {
  if (!running) return res.status(409).json({ error: 'No exploration is running' });
  explorer.requestStop();
  return res.json({ ok: true });
});

app.post('/api/query-map', async (req, res) => {
  try {
    if (!queryClient) return res.status(503).json({ error: 'The reasoning service is not configured' });
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'question is required' });

    const snapshot = explorer.snapshot();
    const arcs = Array.isArray(snapshot.pass1Arcs) ? snapshot.pass1Arcs : [];
    if (!arcs.length) return res.status(409).json({ error: 'The enterprise map has not learned any business workflows yet' });

    const semanticMap = arcs.map((arc) => ({
      id: arc.id,
      title: arc.title || '',
      actor: arc.businessActor || '',
      intent: arc.businessIntent || '',
      stages: Array.isArray(arc.majorStages) ? arc.majorStages : [],
      entities: Array.isArray(arc.entities) ? arc.entities : [],
      persistentObjects: Array.isArray(arc.persistentObjects) ? arc.persistentObjects : [],
      relationships: Array.isArray(arc.relationships) ? arc.relationships : [],
      externalEffects: Array.isArray(arc.externalEffects) ? arc.externalEffects : [],
      outcome: arc.outcome || arc.businessOutcome || '',
      confidence: Number(arc.confidence || 0),
      progress: Number(arc.progress || 0),
      closureState: arc.closureState || '',
      traceability: arc.traceability || null
    }));

    const system = `You are lemap's enterprise semantic-map query layer.
You are given a business question and a semantic map reconstructed from enterprise workflows.
Reason ONLY from the supplied map. Do not claim that historical operational data has already been inspected unless it is explicitly supplied.

Your job is to use workflow context to identify the business concepts that matter, expand through related workflows that share entities, and propose testable explanations and useful analytical views.

Return strict JSON with this shape:
{
  "answer": "short explanation of how to investigate the question from the map",
  "primaryWorkflows": [{"id":"", "title":"", "why":""}],
  "relatedWorkflows": [{"id":"", "title":"", "sharedEntities":[], "whyRelevant":""}],
  "relevantEntities": [],
  "relevantRelationships": [],
  "scenarios": [{"scenario":"", "reasoning":"", "workflowIds":[], "entities":[], "dataNeeded":[]}],
  "candidateViews": [{"name":"", "purpose":"", "entities":[], "dimensions":[], "measures":[]}],
  "nextDrilldowns": []
}

Prefer 3-6 strong scenarios, not an exhaustive list. A scenario must be grounded in at least one supplied workflow/entity/relationship. Related workflows are important: for example Product in sales may connect sales to inventory, catalog/pricing, shipment or returns. Explain those connections through shared entities.`;

    const user = `BUSINESS QUESTION\n${question}\n\nENTERPRISE SEMANTIC MAP\n${JSON.stringify(semanticMap)}`;
    const completion = await queryClient.chat.completions.create({
      model: queryModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 1800
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return res.status(502).json({ error: 'The query layer returned an invalid response' }); }
    return res.json(parsed);
  } catch (error) {
    console.error(`[lemap query] ${error.message}`);
    return res.status(500).json({ error: error.message || 'Query failed' });
  }
});

function broadcast(state) {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) client.write(payload);
}
app.listen(port, () => {
  console.log(`[DataSong v2] http://localhost:${port}`);
  console.log('[DataSong v2] PERSISTENT MAP → CALL-PATH PREPROCESSOR → PASS 1 → PASS 2 → SCOUT');
  console.log('[DataSong v2] Completed flow families are closed at 100%, persisted with call-path/source traceability, and skipped on resume for the same repository commit.');
  console.log('[DataSong v2] QUERY LAYER: business questions reason over the completed/partial semantic map without modifying it.');
});
