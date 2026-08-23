import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { ProgressiveRepositoryTopologyV9 } from './progressiveRepositoryTopologyV9.js';
import { RepositoryExplorer } from './repositoryExplorer.js';
import { registerQueryApi } from './queryApi.js';
import { registerQueryV2Api } from './query_v2/queryApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataRoot = path.join(root, 'data');
const app = express();
const port = Number(process.env.PORT || 3102);
const clients = new Set();

const topology = new ProgressiveRepositoryTopologyV9({ cacheRoot: path.join(dataRoot, 'repo-cache') });
const explorer = new RepositoryExplorer({ topology, dataRoot, onState: (state) => broadcast(state) });
const queryClient = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com', timeout: 60_000 })
  : null;
const queryModel = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
let running = false;
let latestQueryLogPath = '';

const arr = (value) => Array.isArray(value) ? value : [];
const compactText = (value, max = 320) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];
const STOP_WORDS = new Set(['a','an','and','are','as','at','be','by','for','from','how','in','is','it','last','of','on','or','the','to','was','what','when','where','which','why','with','want','know']);

function words(value) {
  return uniq(String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter((v) => v.length > 1 && !STOP_WORDS.has(v)));
}
function wordMatches(queryWord, candidateWord) {
  if (queryWord === candidateWord) return true;
  if (queryWord.length >= 4 && candidateWord.startsWith(queryWord)) return true;
  if (candidateWord.length >= 4 && queryWord.startsWith(candidateWord)) return true;
  return false;
}
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
  const semanticDetail = arr(arc?.workflowSteps).length + arr(arc?.entityDetails).length + arr(arc?.relationshipDetails).length
    + arr(arc?.majorStages).length + arr(arc?.entities).length + arr(arc?.relationships).length + arr(arc?.persistentObjects).length;
  if (calls > 0 || semanticDetail > 0) return 'explored';
  return 'identified';
}
function arcSummary(arc, snapshot) {
  const details = arr(arc?.entityDetails);
  return {
    id: arc.id,
    title: compactText(arc.title, 160),
    actor: compactText(arc.businessActor || arc.trigger, 120),
    intent: compactText(arc.businessIntent, 220),
    outcome: compactText(arc.outcome || arc.businessOutcome, 220),
    entities: uniq([...arr(arc.entities), ...details.map((d) => d?.name)]).slice(0, 16),
    fieldNames: uniq(details.flatMap((d) => arr(d?.fields).map((f) => f?.name))).slice(0, 30),
    relationHints: arr(arc.relationshipDetails).slice(0, 8).map((r) => compactText([r?.from, r?.relation, r?.to].filter(Boolean).join(' → '), 180)),
    progress: Number(arc.progress || 0),
    closureState: arc.closureState || '',
    mapState: mapStateForArc(arc, snapshot),
    businessPriority: Number.isFinite(Number(arc.businessPriority)) ? Number(arc.businessPriority) : null
  };
}
function arcDetail(arc, snapshot) {
  return {
    ...arcSummary(arc, snapshot),
    trigger: compactText(arc.trigger, 260),
    workflowSteps: arr(arc.workflowSteps).slice(0, 30).map((step) => ({
      name: compactText(step?.name, 180),
      description: compactText(step?.description, 520),
      entities: uniq(step?.entities).slice(0, 12),
      persistentObjects: uniq(step?.persistentObjects).slice(0, 12),
      effect: compactText(step?.effect, 320)
    })),
    entityDetails: arr(arc.entityDetails).slice(0, 24).map((entity) => ({
      name: compactText(entity?.name, 160),
      description: compactText(entity?.description, 420),
      schemaResolved: !!entity?.schemaResolved,
      representedBy: arr(entity?.representedBy).slice(0, 8).map((item) => ({
        entityName: compactText(item?.entityName, 160), relation: compactText(item?.relation, 80),
        description: compactText(item?.description, 260), confidence: Number(item?.confidence || 0)
      })),
      fields: arr(entity?.fields).slice(0, 80).map((field) => ({
        name: compactText(field?.name, 180), type: compactText(field?.type, 100), isPk: !!field?.isPk,
        description: compactText(field?.description, 420), sourceEntity: compactText(field?.sourceEntity, 160),
        physicalFieldName: compactText(field?.physicalFieldName, 160), authoritative: field?.authoritative === true
      }))
    })),
    entityRepresentations: arr(arc.entityRepresentations).slice(0, 24).map((item) => ({
      businessEntity: compactText(item?.businessEntity, 160), physicalEntity: compactText(item?.physicalEntity, 160),
      relation: compactText(item?.relation, 80), description: compactText(item?.description, 420), confidence: Number(item?.confidence || 0)
    })),
    relationshipDetails: arr(arc.relationshipDetails).slice(0, 30).map((rel) => ({
      from: compactText(rel?.from, 180), relation: compactText(rel?.relation, 180), to: compactText(rel?.to, 180),
      description: compactText(rel?.description, 520)
    })),
    stages: arr(arc.majorStages).map((v) => compactText(v, 220)),
    entities: arr(arc.entities).map((v) => compactText(v, 140)),
    persistentObjects: arr(arc.persistentObjects).map((v) => compactText(v, 160)),
    relationships: arr(arc.relationships).map((v) => compactText(v, 260)),
    externalEffects: arr(arc.externalEffects).map((v) => compactText(v, 180)),
    traceability: arc.traceability || null
  };
}
function businessArcs(snapshot) { return arr(snapshot?.pass1Arcs).filter(isBusinessArc); }
function allGroupedPaths() {
  if (!topology.callPathIndex) return [];
  const n = Math.min(2500, Math.max(1, Number(topology.callPathIndex.rankedPathCount || 1200)));
  return topology.topCallPaths(n);
}
function pathArc(pathId, snapshot = explorer.snapshot()) {
  return businessArcs(snapshot).find((arc) => [arc.callPathId, ...arr(arc.callPathVariantIds), ...arr(arc.containedCallPathIds), ...arr(arc.relatedCallPathIds)].includes(pathId)) || null;
}
function flowTokens(pathItem) {
  const direct = arr(pathItem?.normalizedFlowTokens).filter(Boolean).map(String);
  if (direct.length) return direct;
  const signatures = arr(pathItem?.signatures).filter(Boolean).map(String);
  if (signatures.length) return signatures;
  return [pathItem?.entrySymbolId].filter(Boolean).map(String);
}
function lexicalScore(query, text) {
  const q = words(query); if (!q.length) return 0;
  const candidate = words(text); if (!candidate.length) return 0;
  let hit = 0;
  for (const qw of q) if (candidate.some((cw) => wordMatches(qw, cw))) hit += 1;
  const phrase = String(text || '').toLowerCase().includes(String(query || '').trim().toLowerCase()) ? 0.8 : 0;
  return hit / q.length + phrase;
}
function pathPreview(pathItem, query) {
  const tokens = flowTokens(pathItem);
  if (!tokens.length) return [];
  const q = words(query);
  const matched = [];
  tokens.forEach((token, index) => {
    const tw = words(token);
    if (q.some((qw) => tw.some((cw) => wordMatches(qw, cw)))) matched.push(index);
  });
  if (!matched.length) return tokens.slice(0, 5);
  const keep = new Set();
  for (const i of matched) for (let j = Math.max(0, i - 1); j <= Math.min(tokens.length - 1, i + 1); j += 1) keep.add(j);
  const out = [];
  let previous = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i > previous + 1 && out.length) out.push('…');
    out.push(compactText(tokens[i], 160));
    previous = i;
  }
  if (Math.max(...keep) < tokens.length - 1) out.push('…');
  return out.slice(0, 13);
}
function pathSearch(query, limit = 12) {
  const snapshot = explorer.snapshot();
  return allGroupedPaths().map((p) => {
    const arc = pathArc(p.id, snapshot);
    const haystack = `${p.entrySymbolId || ''} ${flowTokens(p).join(' ')} ${arr(p.sourcePaths).join(' ')}`;
    const score = lexicalScore(query, haystack);
    return {
      id: p.id,
      score,
      label: compactText(arc?.title || p.entrySymbolId || flowTokens(p)[0] || p.id, 180),
      preview: pathPreview(p, query),
      sourcePaths: uniq(p.sourcePaths).slice(0, 3),
      functionCount: Number(p.functionCount || 0),
      workflowId: arc?.id || '',
      workflowTitle: arc?.title || '',
      status: arc ? mapStateForArc(arc, snapshot) : 'unlearned'
    };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.functionCount - a.functionCount).slice(0, limit);
}
function relevantPathHints(query, limit = 8) {
  return pathSearch(query, limit).map(({ sourcePaths, ...item }) => item);
}
function coverageSummary(snapshot) {
  const total = Number(topology.callPathIndex?.rankedPathCount || 0);
  const reviewed = new Set(arr(snapshot?.scout?.reviewedCallPathIds));
  for (const arc of arr(snapshot?.pass1Arcs)) {
    if (arc.callPathId) reviewed.add(arc.callPathId);
    for (const key of ['callPathVariantIds', 'containedCallPathIds', 'relatedCallPathIds']) for (const id of arr(arc[key])) reviewed.add(id);
  }
  const reviewedCount = total ? Math.min(total, reviewed.size) : reviewed.size;
  return { reviewedPaths: reviewedCount, totalPaths: total, remainingPaths: Math.max(0, total - reviewedCount), percent: total ? Math.round((reviewedCount / total) * 100) : 0 };
}
function normalizedUsage(usage = {}) {
  const prompt = Number(usage.prompt_tokens || usage.input_tokens || 0), completion = Number(usage.completion_tokens || usage.output_tokens || 0);
  const details = usage.prompt_tokens_details || {};
  return { prompt, completion, total: Number(usage.total_tokens || prompt + completion), cacheHit: Number(details.cached_tokens || usage.prompt_cache_hit_tokens || 0), cacheMiss: Number(usage.prompt_cache_miss_tokens || 0) };
}
async function jsonModelCall(system, user, maxTokens = 1200) {
  const completion = await queryClient.chat.completions.create({
    model: queryModel,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' }, temperature: 0.1, max_tokens: maxTokens
  });
  const raw = completion.choices?.[0]?.message?.content || '{}';
  return { parsed: JSON.parse(raw), raw, finishReason: completion.choices?.[0]?.finish_reason || '', usage: normalizedUsage(completion.usage || {}) };
}
function prioritizeArc(arc, message = '') {
  const scheduler = explorer.pass1?.().ensureState?.() || explorer.state.pass1Scheduler || {};
  scheduler.activeArcId = arc.id;
  arc.opportunityScore = 1;
  arc.businessPriority = 1;
  arc.targetedByUser = true;
  arc.lastScheduledStep = Number(explorer.state?.step || 0);
  explorer.state.lastMessage = message || `Targeted ${arc.title || 'selected workflow'} for learning. Press Start to continue.`;
  explorer.pass1?.().syncStories?.();
  explorer.persistSemanticMap?.();
  explorer.emit?.();
  return arc;
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(root, 'public'), { etag: false, lastModified: false, setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); } }));

app.get('/api/state', (_req, res) => { const snapshot = explorer.snapshot(); res.json({ ...snapshot, learningCoverage: coverageSummary(snapshot), visibleBusinessArcIds: businessArcs(snapshot).map((a) => a.id) }); });
app.get('/api/map', (_req, res) => {
  explorer.persistSemanticMap?.(); const snapshot = explorer.snapshot(); const arcs = businessArcs(snapshot);
  res.json({ repoUrl: snapshot.repoUrl || '', commit: snapshot.commit || '', savedAt: snapshot.mapPersistence?.savedAt || '', restored: !!snapshot.mapPersistence?.restored, coverage: coverageSummary(snapshot), workflows: arcs.map((arc) => arcDetail(arc, snapshot)) });
});

app.get('/api/search-learning', (req, res) => {
  if (running) return res.status(409).json({ error: 'Stop learning before searching for a targeted workflow.' });
  const raw = compactText(req.query.q, 120), q = raw.toLowerCase();
  if (!q) return res.json({ query: '', workflows: [], pathMatches: [] });
  const snapshot = explorer.snapshot();
  const workflows = businessArcs(snapshot).map((arc) => ({ ...arcSummary(arc, snapshot), score: lexicalScore(q, `${arc.title} ${arc.businessActor || arc.trigger} ${arc.businessIntent} ${arc.outcome || arc.businessOutcome} ${arr(arc.entities).join(' ')} ${arr(arc.relationships).join(' ')}`) }))
    .filter((w) => w.score > 0).sort((a, b) => b.score - a.score || Number(b.businessPriority || 0) - Number(a.businessPriority || 0)).slice(0, 12);
  return res.json({ query: raw, workflows, pathMatches: pathSearch(q, 12) });
});

app.post('/api/prioritize-workflow', (req, res) => {
  if (running) return res.status(409).json({ error: 'Stop learning before changing the targeted workflow.' });
  const id = String(req.body?.workflowId || '');
  const arc = explorer.pass1?.().arcByReference?.(id) || arr(explorer.state?.pass1Arcs).find((a) => a.id === id);
  if (!arc || !isBusinessArc(arc)) return res.status(404).json({ error: 'Workflow not found' });
  prioritizeArc(arc);
  return res.json({ ok: true, workflowId: arc.id, running, state: mapStateForArc(arc, explorer.snapshot()) });
});

app.post('/api/prioritize-path', async (req, res) => {
  try {
    if (running) return res.status(409).json({ error: 'Stop learning before targeting another path.' });
    if (!queryClient) return res.status(503).json({ error: 'The reasoning service is not configured' });
    const pathId = String(req.body?.pathId || '');
    const grouped = allGroupedPaths().find((p) => p.id === pathId);
    if (!grouped) return res.status(404).json({ error: 'Path not found' });
    const existing = pathArc(pathId);
    if (existing) {
      prioritizeArc(existing);
      return res.json({ ok: true, workflowId: existing.id, existing: true, title: existing.title, state: mapStateForArc(existing, explorer.snapshot()) });
    }

    const compact = explorer.compactCallPath?.(grouped) || { pathId: grouped.id, functionCount: grouped.functionCount, flowSequence: flowTokens(grouped) };
    const system = `You are lemap's targeted business-flow classifier. Decide whether one supplied compressed executable path is a coherent business workflow. Do not invent omitted behavior. Return strict JSON: {"classification":"business_flow|technical|uncertain","confidence":0,"flowTitle":"","businessActor":"","businessIntent":"","completionCondition":"","businessOutcome":"","reason":""}.`;
    const user = `TARGETED_PATH\n${JSON.stringify(compact)}\n\nA business_flow must represent a recognizable actor/business goal with a completion condition or outcome. Keep the answer compact.`;
    const call = await jsonModelCall(system, user, 650);
    const item = call.parsed || {};
    if (item.classification !== 'business_flow' || Number(item.confidence || 0) < 0.5 || !compactText(item.flowTitle, 180)) {
      return res.status(422).json({ error: 'This matching path does not yet provide enough evidence for a business workflow.', classification: item.classification || 'uncertain', reason: compactText(item.reason, 300) });
    }
    const arc = explorer.pass1().createArc({
      title: compactText(item.flowTitle, 180), concept: compactText(item.reason, 320), businessActor: compactText(item.businessActor, 220),
      businessIntent: compactText(item.businessIntent, 300), confidence: Number(item.confidence || 0), qualifiesAsBusinessUseCase: true, qualification: 'business_use_case'
    }, { id: grouped.entrySymbolId || pathId, path: arr(grouped.sourcePaths)[0] || '' });
    if (!arc) return res.status(500).json({ error: 'Could not create a workflow from this path.' });
    arc.callPathId = grouped.id;
    arc.callPathVariantIds = arr(grouped.alternatives).map((alt) => alt.pathId);
    arc.seedArtifactId = grouped.entrySymbolId || '';
    arc.seedSourcePath = arr(grouped.sourcePaths)[0] || '';
    arc.seedSource = 'targeted_path_search';
    arc.completionCondition = compactText(item.completionCondition, 300);
    arc.businessOutcome = compactText(item.businessOutcome, 320);
    arc.status = 'forming';
    arc.progress = 0;
    explorer.pass2().seed(arc.id);
    explorer.flowState?.(arc);
    prioritizeArc(arc, `Found ${arc.title}. It is targeted for learning; press Start to interpret the flow.`);
    return res.json({ ok: true, workflowId: arc.id, existing: false, title: arc.title, state: 'identified' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not target path' });
  }
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

registerQueryApi({
  app,
  explorer,
  queryClient,
  queryModel,
  dataRoot,
  businessArcs,
  mapStateForArc,
  relevantPathHints,
  onLatestLog: (file) => { latestQueryLogPath = file; }
});

registerQueryV2Api({
  app,
  explorer,
  queryClient,
  queryModel,
  dataRoot,
  onLatestLog: (file) => { latestQueryLogPath = file; }
});

function broadcast(state) {
  const snapshot = state || explorer.snapshot();
  const payload = `data: ${JSON.stringify({ ...snapshot, learningCoverage: coverageSummary(snapshot), visibleBusinessArcIds: businessArcs(snapshot).map((a) => a.id) })}\n\n`;
  for (const client of clients) client.write(payload);
}

app.listen(port, () => {
  console.log(`[DataSong v2] http://localhost:${port}`);
  console.log('[DataSong v2] PERSISTENT MAP → FULL CALL-PATH SCOUT → PASS 1 → PASS 2');
  console.log('[DataSong v2] Targeted search spans learned workflows and compressed call paths; selected paths become Pass-1 learning targets.');
  console.log('[DataSong v2] QUERY: DeepSeek navigates the semantic map through bounded tools; query sessions/logs are stored under data/query-runs/.');
  console.log('[DataSong v2] QUERY V2: intent → clusters → entities → local shortest evidenced joins → grounded answer.');
});