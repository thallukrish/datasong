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

const arr = (value) => Array.isArray(value) ? value : [];
const compactText = (value, max = 320) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);

function arcSummary(arc) {
  return {
    id: arc.id,
    title: compactText(arc.title, 160),
    actor: compactText(arc.businessActor, 120),
    intent: compactText(arc.businessIntent, 220),
    outcome: compactText(arc.outcome || arc.businessOutcome, 220),
    progress: Number(arc.progress || 0),
    closureState: arc.closureState || ''
  };
}

function arcDetail(arc) {
  return {
    ...arcSummary(arc),
    concept: compactText(arc.concept || arc.pathNature, 280),
    stages: arr(arc.majorStages).map((v) => compactText(v, 180)),
    entities: arr(arc.entities).map((v) => compactText(v, 140)),
    persistentObjects: arr(arc.persistentObjects).map((v) => compactText(v, 160)),
    relationships: arr(arc.relationships).map((v) => compactText(v, 220)),
    externalEffects: arr(arc.externalEffects).map((v) => compactText(v, 180)),
    traceability: arc.traceability || null
  };
}

async function jsonModelCall(system, user, maxTokens = 1200) {
  const completion = await queryClient.chat.completions.create({
    model: queryModel,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: maxTokens
  });
  const raw = completion.choices?.[0]?.message?.content || '{}';
  return JSON.parse(raw);
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(root, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); }
}));

app.get('/api/state', (_req, res) => res.json(explorer.snapshot()));

app.get('/api/map', (_req, res) => {
  // Keep the map screen tied to the durable creation-layer state. Persist before
  // returning so what the user browses is the same semantic state stored on disk.
  explorer.persistSemanticMap?.();
  const snapshot = explorer.snapshot();
  const arcs = arr(snapshot.pass1Arcs);
  return res.json({
    repoUrl: snapshot.repoUrl || '',
    commit: snapshot.commit || '',
    savedAt: snapshot.mapPersistence?.savedAt || '',
    restored: !!snapshot.mapPersistence?.restored,
    workflows: arcs.map(arcDetail)
  });
});

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

    explorer.persistSemanticMap?.();
    const snapshot = explorer.snapshot();
    const arcs = arr(snapshot.pass1Arcs);
    if (!arcs.length) return res.status(409).json({ error: 'The enterprise map has not learned any business workflows yet' });

    // Stage 1: retrieval. Send ONLY top-level workflow summaries. The model is not
    // allowed to answer the business question here; it only selects the smallest
    // useful workflow set for the question.
    const summaries = arcs.map(arcSummary);
    const selectorSystem = `You are lemap's semantic-map workflow selector.
Given a business question and ONLY top-level workflow summaries, select the smallest set of workflows whose detailed semantic content is needed to answer or investigate the question.
Do not answer the question. Do not infer entities that are not supplied. Prefer 1-4 workflows; include an extra workflow only when its top-level intent/outcome makes it plausibly explanatory.
Return strict JSON only: {"workflowIds":["exact ids"],"selectionReason":"one short sentence"}.`;
    const selected = await jsonModelCall(
      selectorSystem,
      `QUESTION\n${question}\n\nWORKFLOWS\n${JSON.stringify(summaries)}`,
      500
    );
    const allowed = new Set(arcs.map((arc) => arc.id));
    let selectedIds = arr(selected.workflowIds).filter((id) => allowed.has(id)).slice(0, 4);
    if (!selectedIds.length) selectedIds = arcs.slice(0, Math.min(2, arcs.length)).map((arc) => arc.id);

    // Stage 2: reasoning. Only the selected workflows are expanded. This keeps the
    // prompt proportional to what the business question actually touches.
    const details = arcs.filter((arc) => selectedIds.includes(arc.id)).map(arcDetail);
    const answerSystem = `You are lemap's enterprise semantic-map query layer.
Answer or frame the business question using ONLY the supplied selected workflow details reconstructed by lemap.
The semantic map contains meaning and structure, not historical measurements. Never claim a factual operational cause unless the supplied map itself proves it.
Use entities, concepts, stages and relationships from these workflows to explain what can be concluded, what plausible scenarios are structurally supported, and what data view or drill-down would test them.
Be concise. Do not dump the map.
Return strict JSON only:
{
  "answer":"clean concise answer",
  "workflowsUsed":[{"id":"","title":"","role":"why it matters"}],
  "relevantEntities":[],
  "relevantRelationships":[],
  "scenarios":[{"scenario":"","why":"","dataToCheck":[]}],
  "candidateView":{"purpose":"","entities":[],"dimensions":[],"measures":[]},
  "nextStep":"single most useful next analytical step"
}`;
    const answer = await jsonModelCall(
      answerSystem,
      `QUESTION\n${question}\n\nSELECTED WORKFLOW DETAILS\n${JSON.stringify(details)}`,
      1400
    );

    return res.json({
      ...answer,
      retrieval: {
        workflowIds: selectedIds,
        selectionReason: compactText(selected.selectionReason, 280)
      }
    });
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
  console.log('[DataSong v2] QUERY: top-level workflow selection first; only selected workflow semantics are expanded for the final reasoning call.');
});
