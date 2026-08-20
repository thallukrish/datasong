import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { ProgressiveRepositoryTopologyV9 } from './progressiveRepositoryTopologyV9.js';
import { ProgressiveRepositoryExplorerV47 } from './progressiveRepositoryExplorerV47.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataRoot = path.join(root, 'data');
const app = express();
const port = Number(process.env.PORT || 3102);
const clients = new Set();

const topology = new ProgressiveRepositoryTopologyV9({ cacheRoot: path.join(dataRoot, 'repo-cache') });
const explorer = new ProgressiveRepositoryExplorerV47({ topology, dataRoot, onState: (state) => broadcast(state) });
const queryClient = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com', timeout: 60_000 })
  : null;
const queryModel = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
let running = false;
let latestQueryLogPath = '';

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

function queryRunPath() {
  const dir = path.join(dataRoot, 'query-runs');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `${stamp}.jsonl`);
}

function appendQueryLog(file, event) {
  if (!file) return;
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
}

function normalizedUsage(usage = {}) {
  const prompt = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const completion = Number(usage.completion_tokens || usage.output_tokens || 0);
  const total = Number(usage.total_tokens || (prompt + completion));
  const details = usage.prompt_tokens_details || {};
  return {
    prompt,
    completion,
    total,
    cacheHit: Number(details.cached_tokens || usage.prompt_cache_hit_tokens || 0),
    cacheMiss: Number(usage.prompt_cache_miss_tokens || 0)
  };
}

function addUsage(total, usage) {
  total.prompt += usage.prompt;
  total.completion += usage.completion;
  total.total += usage.total;
  total.cacheHit += usage.cacheHit;
  total.cacheMiss += usage.cacheMiss;
  return total;
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
  return {
    parsed: JSON.parse(raw),
    raw,
    finishReason: completion.choices?.[0]?.finish_reason || '',
    usage: normalizedUsage(completion.usage || {})
  };
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(root, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); }
}));

app.get('/api/state', (_req, res) => res.json(explorer.snapshot()));

app.get('/api/map', (_req, res) => {
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
  if (!explorer.runLogPath) return res.status(404).json({ error: 'No learning run log is available yet' });
  return res.download(explorer.runLogPath, path.basename(explorer.runLogPath));
});

app.get('/api/query-log', (_req, res) => {
  if (!latestQueryLogPath || !fs.existsSync(latestQueryLogPath)) {
    return res.status(404).json({ error: 'No query run log is available yet' });
  }
  return res.download(latestQueryLogPath, path.basename(latestQueryLogPath));
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
  const queryLog = queryRunPath();
  latestQueryLogPath = queryLog;
  const cumulativeUsage = { prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 };
  const startedAt = new Date().toISOString();

  try {
    if (!queryClient) return res.status(503).json({ error: 'The reasoning service is not configured' });
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'question is required' });

    explorer.persistSemanticMap?.();
    const snapshot = explorer.snapshot();
    const arcs = arr(snapshot.pass1Arcs);
    if (!arcs.length) return res.status(409).json({ error: 'The enterprise map has not learned any business workflows yet' });

    appendQueryLog(queryLog, {
      type: 'query_start',
      timestamp: startedAt,
      question,
      repoUrl: snapshot.repoUrl || '',
      commit: snapshot.commit || '',
      workflowCount: arcs.length
    });

    const summaries = arcs.map(arcSummary);
    const selectorSystem = `You are lemap's semantic-map workflow selector.
Given a business question and ONLY top-level workflow summaries, select the smallest set of workflows whose detailed semantic content is needed to answer or investigate the question.
Do not answer the question. Do not infer entities that are not supplied. Prefer 1-4 workflows; include an extra workflow only when its top-level intent/outcome makes it plausibly explanatory.
Return strict JSON only: {"workflowIds":["exact ids"],"selectionReason":"one short sentence"}.`;
    const selectorUser = `QUESTION\n${question}\n\nWORKFLOWS\n${JSON.stringify(summaries)}`;
    const selectorCall = await jsonModelCall(selectorSystem, selectorUser, 500);
    addUsage(cumulativeUsage, selectorCall.usage);

    appendQueryLog(queryLog, {
      type: 'workflow_selection_call',
      timestamp: new Date().toISOString(),
      model: queryModel,
      systemPrompt: selectorSystem,
      prompt: selectorUser,
      rawResponse: selectorCall.raw,
      parsedResponse: selectorCall.parsed,
      finishReason: selectorCall.finishReason,
      usage: selectorCall.usage,
      cumulativeUsage: { ...cumulativeUsage }
    });

    const allowed = new Set(arcs.map((arc) => arc.id));
    let selectedIds = arr(selectorCall.parsed.workflowIds).filter((id) => allowed.has(id)).slice(0, 4);
    if (!selectedIds.length) selectedIds = arcs.slice(0, Math.min(2, arcs.length)).map((arc) => arc.id);

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
    const answerUser = `QUESTION\n${question}\n\nSELECTED WORKFLOW DETAILS\n${JSON.stringify(details)}`;
    const answerCall = await jsonModelCall(answerSystem, answerUser, 1400);
    addUsage(cumulativeUsage, answerCall.usage);

    appendQueryLog(queryLog, {
      type: 'answer_call',
      timestamp: new Date().toISOString(),
      model: queryModel,
      selectedWorkflowIds: selectedIds,
      systemPrompt: answerSystem,
      prompt: answerUser,
      rawResponse: answerCall.raw,
      parsedResponse: answerCall.parsed,
      finishReason: answerCall.finishReason,
      usage: answerCall.usage,
      cumulativeUsage: { ...cumulativeUsage }
    });

    const response = {
      ...answerCall.parsed,
      retrieval: {
        workflowIds: selectedIds,
        selectionReason: compactText(selectorCall.parsed.selectionReason, 280)
      }
    };

    appendQueryLog(queryLog, {
      type: 'query_complete',
      timestamp: new Date().toISOString(),
      question,
      selectedWorkflowIds: selectedIds,
      response,
      cumulativeUsage: { ...cumulativeUsage }
    });

    console.log(`[lemap query] tokens ${cumulativeUsage.total} (prompt ${cumulativeUsage.prompt}, completion ${cumulativeUsage.completion}) — ${question}`);
    return res.json(response);
  } catch (error) {
    appendQueryLog(queryLog, {
      type: 'query_error',
      timestamp: new Date().toISOString(),
      error: error.message || String(error),
      cumulativeUsage: { ...cumulativeUsage }
    });
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
  console.log('[DataSong v2] PERSISTENT MAP → FULL CALL-PATH SCOUT → PASS 1 → PASS 2');
  console.log('[DataSong v2] Scout widens through the ranked call-path index until unseen entrances are exhausted. Path interpretation and business-workflow closure are separate: only sufficiently evidenced workflows close at 100%.');
  console.log('[DataSong v2] QUERY: top-level workflow selection first; only selected workflow semantics are expanded for the final reasoning call. Query LLM calls are logged separately under data/query-runs/.');
});