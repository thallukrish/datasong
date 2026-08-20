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
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];

function isBusinessArc(arc) {
  const marks = [arc?.classification, arc?.qualification, arc?.pathNature, arc?.evidenceClassification]
    .map((v) => String(v || '').toLowerCase());
  if (marks.some((v) => v === 'technical' || v === 'technical_flow' || v.includes('not_business'))) return false;
  if (arc?.qualifiesAsBusinessUseCase === false) return false;
  return true;
}

function mapStateForArc(arc, snapshot) {
  if (arc?.closureState === 'closed') return 'complete';
  const flow = snapshot?.pass2WholeFlowByArc?.[arc?.id];
  const calls = Number(flow?.wholeFlowCalls || 0) + Number(flow?.branchCalls || 0);
  const semanticDetail = arr(arc?.majorStages).length + arr(arc?.entities).length + arr(arc?.relationships).length + arr(arc?.persistentObjects).length;
  if (calls > 0 || semanticDetail > 0) return 'explored';
  return 'identified';
}

function arcSummary(arc, snapshot) {
  return {
    id: arc.id,
    title: compactText(arc.title, 160),
    actor: compactText(arc.businessActor, 120),
    intent: compactText(arc.businessIntent, 220),
    outcome: compactText(arc.outcome || arc.businessOutcome, 220),
    progress: Number(arc.progress || 0),
    closureState: arc.closureState || '',
    mapState: mapStateForArc(arc, snapshot)
  };
}

function arcDetail(arc, snapshot) {
  return {
    ...arcSummary(arc, snapshot),
    stages: arr(arc.majorStages).map((v) => compactText(v, 180)),
    entities: arr(arc.entities).map((v) => compactText(v, 140)),
    persistentObjects: arr(arc.persistentObjects).map((v) => compactText(v, 160)),
    relationships: arr(arc.relationships).map((v) => compactText(v, 220)),
    externalEffects: arr(arc.externalEffects).map((v) => compactText(v, 180)),
    traceability: arc.traceability || null
  };
}

function businessArcs(snapshot) {
  return arr(snapshot?.pass1Arcs).filter(isBusinessArc);
}

function coverageSummary(snapshot) {
  const total = Number(topology.callPathIndex?.rankedPathCount || 0);
  const reviewed = new Set(arr(snapshot?.scout?.reviewedCallPathIds));
  for (const arc of arr(snapshot?.pass1Arcs)) {
    if (arc.callPathId) reviewed.add(arc.callPathId);
    for (const key of ['callPathVariantIds', 'containedCallPathIds', 'relatedCallPathIds']) {
      for (const id of arr(arc[key])) reviewed.add(id);
    }
  }
  const reviewedCount = total ? Math.min(total, reviewed.size) : reviewed.size;
  return {
    reviewedPaths: reviewedCount,
    totalPaths: total,
    remainingPaths: Math.max(0, total - reviewedCount),
    percent: total ? Math.round((reviewedCount / total) * 100) : 0
  };
}

function queryRunPath() {
  const dir = path.join(dataRoot, 'query-runs');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `${stamp}.jsonl`);
}
function appendQueryLog(file, event) { if (file) fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8'); }
function normalizedUsage(usage = {}) {
  const prompt = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const completion = Number(usage.completion_tokens || usage.output_tokens || 0);
  const details = usage.prompt_tokens_details || {};
  return {
    prompt, completion, total: Number(usage.total_tokens || prompt + completion),
    cacheHit: Number(details.cached_tokens || usage.prompt_cache_hit_tokens || 0),
    cacheMiss: Number(usage.prompt_cache_miss_tokens || 0)
  };
}
function addUsage(total, usage) { for (const k of Object.keys(total)) total[k] += Number(usage[k] || 0); return total; }
async function jsonModelCall(system, user, maxTokens = 1200) {
  const completion = await queryClient.chat.completions.create({
    model: queryModel,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' }, temperature: 0.1, max_tokens: maxTokens
  });
  const raw = completion.choices?.[0]?.message?.content || '{}';
  return { parsed: JSON.parse(raw), raw, finishReason: completion.choices?.[0]?.finish_reason || '', usage: normalizedUsage(completion.usage || {}) };
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(root, 'public'), { etag: false, lastModified: false, setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); } }));

app.get('/api/state', (_req, res) => {
  const snapshot = explorer.snapshot();
  res.json({ ...snapshot, learningCoverage: coverageSummary(snapshot), visibleBusinessArcIds: businessArcs(snapshot).map((a) => a.id) });
});

app.get('/api/map', (_req, res) => {
  explorer.persistSemanticMap?.();
  const snapshot = explorer.snapshot();
  const arcs = businessArcs(snapshot);
  res.json({
    repoUrl: snapshot.repoUrl || '', commit: snapshot.commit || '', savedAt: snapshot.mapPersistence?.savedAt || '',
    restored: !!snapshot.mapPersistence?.restored, coverage: coverageSummary(snapshot), workflows: arcs.map((arc) => arcDetail(arc, snapshot))
  });
});

app.get('/api/search-learning', (req, res) => {
  const q = compactText(req.query.q, 120).toLowerCase();
  if (!q) return res.json({ query: '', workflows: [], pathMatches: [] });
  const snapshot = explorer.snapshot();
  const workflows = businessArcs(snapshot)
    .map((arc) => arcSummary(arc, snapshot))
    .filter((w) => `${w.title} ${w.actor} ${w.intent} ${w.outcome}`.toLowerCase().includes(q))
    .slice(0, 20);
  const pathMatches = topology.callPathIndex
    ? topology.topCallPaths(Math.min(1200, Number(topology.callPathIndex.rankedPathCount || 1200)))
      .filter((p) => `${p.entrySymbolId || ''} ${arr(p.signatures).join(' ')}`.toLowerCase().includes(q))
      .slice(0, 12)
      .map((p) => ({ id: p.id, label: compactText(p.entrySymbolId || arr(p.signatures)[0] || p.id, 180), sourcePaths: uniq(p.sourcePaths).slice(0, 3) }))
    : [];
  return res.json({ query: q, workflows, pathMatches });
});

app.post('/api/prioritize-workflow', (req, res) => {
  const id = String(req.body?.workflowId || '');
  const arc = explorer.pass1?.().arcByReference?.(id) || arr(explorer.state?.pass1Arcs).find((a) => a.id === id);
  if (!arc || !isBusinessArc(arc)) return res.status(404).json({ error: 'Workflow not found' });
  const scheduler = explorer.pass1?.().ensureState?.() || explorer.state.pass1Scheduler || {};
  scheduler.activeArcId = arc.id;
  arc.opportunityScore = 1;
  arc.lastScheduledStep = Number(explorer.state?.step || 0);
  explorer.state.lastMessage = `Prioritized ${arc.title || 'selected workflow'} for learning.`;
  explorer.persistSemanticMap?.();
  explorer.emit?.();
  return res.json({ ok: true, workflowId: arc.id, running, state: mapStateForArc(arc, explorer.snapshot()) });
});

app.get('/api/call-paths', (_req, res) => res.json({ ready: !!topology.callPathIndex, xmlAdapter: topology.moquiXmlExecution, topPaths: topology.callPathIndex ? topology.topCallPaths(10) : [] }));
app.get('/api/run-log', (_req, res) => explorer.runLogPath ? res.download(explorer.runLogPath, path.basename(explorer.runLogPath)) : res.status(404).json({ error: 'No learning run log is available yet' }));
app.get('/api/query-log', (_req, res) => latestQueryLogPath && fs.existsSync(latestQueryLogPath) ? res.download(latestQueryLogPath, path.basename(latestQueryLogPath)) : res.status(404).json({ error: 'No query run log is available yet' }));
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  clients.add(res); const snapshot = explorer.snapshot(); res.write(`data: ${JSON.stringify({ ...snapshot, learningCoverage: coverageSummary(snapshot), visibleBusinessArcIds: businessArcs(snapshot).map((a) => a.id) })}\n\n`);
  req.on('close', () => clients.delete(res));
});

app.post('/api/explore', async (req, res) => {
  const repoUrl = String(req.body?.repoUrl || '').trim();
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });
  if (running) return res.status(409).json({ error: 'An exploration is already running' });
  running = true; res.status(202).json({ ok: true });
  explorer.run(repoUrl)
    .then((state) => console.log(`[DataSong v2] ${state.status} — ${state.lastMessage || 'exploration finished'}`))
    .catch((error) => { const state = explorer.snapshot(); state.status = 'error'; state.lastMessage = error.message; explorer.state = state; broadcast(state); console.error(`[DataSong v2] exploration failed: ${error.message}`); })
    .finally(() => { running = false; });
});
app.post('/api/stop', (_req, res) => { if (!running) return res.status(409).json({ error: 'No exploration is running' }); explorer.requestStop(); return res.json({ ok: true }); });

app.post('/api/query-map', async (req, res) => {
  const queryLog = queryRunPath(); latestQueryLogPath = queryLog;
  const cumulativeUsage = { prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 };
  try {
    if (!queryClient) return res.status(503).json({ error: 'The reasoning service is not configured' });
    const question = String(req.body?.question || '').trim(); if (!question) return res.status(400).json({ error: 'question is required' });
    explorer.persistSemanticMap?.();
    const snapshot = explorer.snapshot(); const arcs = businessArcs(snapshot);
    if (!arcs.length) return res.status(409).json({ error: 'The enterprise map has not identified any business workflows yet' });
    appendQueryLog(queryLog, { type: 'query_start', timestamp: new Date().toISOString(), question, repoUrl: snapshot.repoUrl || '', commit: snapshot.commit || '', workflowCount: arcs.length });

    const summaries = arcs.map((arc) => arcSummary(arc, snapshot));
    const selectorSystem = `You are lemap's workflow selector. Given a business question and top-level workflow summaries, select the smallest relevant set. Workflows have mapState=identified|explored|complete. Do not pretend an identified workflow has semantic detail. Return strict JSON only: {"exploredWorkflowIds":["ids that are explored or complete and useful"],"identifiedWorkflowIds":["relevant ids that are only identified"],"selectionReason":"short"}. Prefer at most 4 total.`;
    const selectorUser = `QUESTION\n${question}\n\nWORKFLOWS\n${JSON.stringify(summaries)}`;
    const selectorCall = await jsonModelCall(selectorSystem, selectorUser, 500); addUsage(cumulativeUsage, selectorCall.usage);
    appendQueryLog(queryLog, { type: 'workflow_selection_call', timestamp: new Date().toISOString(), model: queryModel, systemPrompt: selectorSystem, prompt: selectorUser, rawResponse: selectorCall.raw, parsedResponse: selectorCall.parsed, finishReason: selectorCall.finishReason, usage: selectorCall.usage, cumulativeUsage: { ...cumulativeUsage } });

    const byId = new Map(arcs.map((a) => [a.id, a]));
    const exploredIds = uniq(selectorCall.parsed.exploredWorkflowIds).filter((id) => byId.has(id) && mapStateForArc(byId.get(id), snapshot) !== 'identified').slice(0, 4);
    const identifiedIds = uniq(selectorCall.parsed.identifiedWorkflowIds).filter((id) => byId.has(id) && mapStateForArc(byId.get(id), snapshot) === 'identified').slice(0, 4);
    const identifiedRelevantWorkflows = identifiedIds.map((id) => arcSummary(byId.get(id), snapshot));

    if (!exploredIds.length) {
      const response = {
        answer: identifiedRelevantWorkflows.length
          ? 'The most relevant workflows have been identified but have not yet been explored deeply enough to answer from the map.'
          : 'The learned map does not yet contain an explored workflow with enough semantic detail for this question.',
        workflowsUsed: [], relevantEntities: [], relevantRelationships: [], scenarios: [], candidateView: {},
        nextStep: identifiedRelevantWorkflows.length ? `Explore ${identifiedRelevantWorkflows[0].title} first.` : 'Continue learning or target a relevant workflow.',
        identifiedRelevantWorkflows,
        retrieval: { workflowIds: [], identifiedWorkflowIds: identifiedIds, selectionReason: compactText(selectorCall.parsed.selectionReason, 280) }
      };
      appendQueryLog(queryLog, { type: 'query_complete', timestamp: new Date().toISOString(), question, response, cumulativeUsage: { ...cumulativeUsage } });
      return res.json(response);
    }

    const details = exploredIds.map((id) => arcDetail(byId.get(id), snapshot));
    const answerSystem = `You are lemap's enterprise-map query layer. Answer or frame the question using ONLY the supplied explored workflow details. The map contains structure, not historical measurements; never invent measured values. Use only evidenced entities/stages/relationships. Be concise and do not dump the map. Return strict JSON: {"answer":"", "workflowsUsed":[{"id":"","title":"","role":""}], "relevantEntities":[], "relevantRelationships":[], "scenarios":[{"scenario":"","why":"","dataToCheck":[]}], "candidateView":{"purpose":"","entities":[],"dimensions":[],"measures":[]}, "nextStep":""}.`;
    const answerUser = `QUESTION\n${question}\n\nEXPLORED WORKFLOW DETAILS\n${JSON.stringify(details)}`;
    const answerCall = await jsonModelCall(answerSystem, answerUser, 1400); addUsage(cumulativeUsage, answerCall.usage);
    appendQueryLog(queryLog, { type: 'answer_call', timestamp: new Date().toISOString(), model: queryModel, selectedWorkflowIds: exploredIds, systemPrompt: answerSystem, prompt: answerUser, rawResponse: answerCall.raw, parsedResponse: answerCall.parsed, finishReason: answerCall.finishReason, usage: answerCall.usage, cumulativeUsage: { ...cumulativeUsage } });

    const response = { ...answerCall.parsed, identifiedRelevantWorkflows, retrieval: { workflowIds: exploredIds, identifiedWorkflowIds: identifiedIds, selectionReason: compactText(selectorCall.parsed.selectionReason, 280) } };
    appendQueryLog(queryLog, { type: 'query_complete', timestamp: new Date().toISOString(), question, response, cumulativeUsage: { ...cumulativeUsage } });
    console.log(`[lemap query] tokens ${cumulativeUsage.total} (prompt ${cumulativeUsage.prompt}, completion ${cumulativeUsage.completion}) — ${question}`);
    return res.json(response);
  } catch (error) {
    appendQueryLog(queryLog, { type: 'query_error', timestamp: new Date().toISOString(), error: error.message || String(error), cumulativeUsage: { ...cumulativeUsage } });
    console.error(`[lemap query] ${error.message}`); return res.status(500).json({ error: error.message || 'Query failed' });
  }
});

function broadcast(state) {
  const snapshot = state || explorer.snapshot();
  const payload = `data: ${JSON.stringify({ ...snapshot, learningCoverage: coverageSummary(snapshot), visibleBusinessArcIds: businessArcs(snapshot).map((a) => a.id) })}\n\n`;
  for (const client of clients) client.write(payload);
}

app.listen(port, () => {
  console.log(`[DataSong v2] http://localhost:${port}`);
  console.log('[DataSong v2] PERSISTENT MAP → FULL CALL-PATH SCOUT → PASS 1 → PASS 2');
  console.log('[DataSong v2] UI exposes only business workflows; overall progress is deterministic path coverage. Targeted workflow search/prioritization is deterministic.');
  console.log('[DataSong v2] QUERY: workflow summaries select scope; only explored workflow detail is sent to final reasoning. Query LLM calls are logged under data/query-runs/.');
});
