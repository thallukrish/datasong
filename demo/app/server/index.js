import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { executeTool } from './modelTools.js';
import { semanticStore } from './store.js';

const app = express();
const port = Number(process.env.PORT || 3101);
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const MODEL_TIMEOUT_MS = 45_000;
const MAX_MODEL_TOKENS = 3000;
const MAX_WORKFLOW_ROUNDS = 24;
const MAX_COMPACT_FINDINGS = 32;
const deepseek = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com', timeout: MODEL_TIMEOUT_MS })
  : null;
const clients = new Set();

const STORY_WEIGHTS = {
  trigger: 10,
  actors: 10,
  concepts: 10,
  steps: 20,
  rules: 15,
  persistentReads: 10,
  persistentWrites: 10,
  outcome: 7,
  nextWorkflow: 3,
  evidenceCoverage: 5
};

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.get('/api/state', (_req, res) => res.json(semanticStore.snapshot()));
app.post('/api/reset', (_req, res) => { semanticStore.reset(); broadcast(); res.json({ ok: true }); });

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'snapshot', state: semanticStore.snapshot() })}\n\n`);
  req.on('close', () => clients.delete(res));
});

app.post('/api/explore', async (req, res) => {
  const { businessDescription, repoUrl } = req.body || {};
  if (!businessDescription || !repoUrl) return res.status(400).json({ error: 'businessDescription and repoUrl are required' });
  if (!deepseek) return res.status(400).json({ error: 'DEEPSEEK_API_KEY is not configured' });
  const priorKnowledge = semanticStore.knowledgeSummary();
  semanticStore.begin({ businessDescription, repoUrl });
  broadcast();
  res.status(202).json({ ok: true });
  explore({ businessDescription, repoUrl, priorKnowledge }).catch((error) => {
    semanticStore.state.status = 'error';
    semanticStore.emit({ type: 'error', message: error.message });
    broadcast();
  });
});

async function explore({ businessDescription, repoUrl, priorKnowledge }) {
  const tokenUsage = emptyTokenUsage();

  semanticStore.emit({ type: 'tool_started', tool: 'repo_prepare', args: { repoUrl }, message: 'Assessing repository changes from Git…' });
  broadcast();
  const repoPreparation = await executeTool('repo_prepare', { repoUrl });
  semanticStore.emit({ type: 'tool_completed', tool: 'repo_prepare', args: { repoUrl }, resultPreview: preview(repoPreparation) });
  semanticStore.emit({ type: 'learning_update', message: assessmentMessage(repoPreparation) });
  broadcast();

  const plan = repoPreparation.workflowPlan;
  const pending = plan.tasks.filter((task) => task.status === 'pending');
  if (!pending.length) {
    semanticStore.complete(`Repository synchronized. ${plan.reusedWorkflows} known workflow${plan.reusedWorkflows === 1 ? '' : 's'} reused because its supporting source did not change.`);
    printTokenSummary(tokenUsage);
    broadcast();
    return;
  }

  for (const task of pending) {
    semanticStore.startWorkflowTask(task.id);
    semanticStore.emit({ type: 'learning_update', workflowTaskId: task.id, message: `${task.mode === 'review' ? 'Rechecking' : 'Learning'} end-to-end workflow: ${task.name}.` });
    broadcast();
    await exploreWorkflow({ task, businessDescription, repoUrl, repoPreparation, tokenUsage });
  }

  const finished = semanticStore.workflowPlan();
  semanticStore.complete(`Repository synchronized at ${shortSha(repoPreparation.currentCommit)}. Completed ${finished.completedWorkflows} workflow task${finished.completedWorkflows === 1 ? '' : 's'} and reused ${finished.reusedWorkflows} unchanged workflow${finished.reusedWorkflows === 1 ? '' : 's'}.`);
  printTokenSummary(tokenUsage);
  broadcast();
}

async function exploreWorkflow({ task, businessDescription, repoUrl, repoPreparation, tokenUsage }) {
  const working = {
    storySummary: '',
    checklist: emptyChecklist(),
    findings: [],
    visited: { searches: new Set(), lists: new Set(), ranges: new Map(), symbols: new Set() },
    blockedRevisits: 0
  };

  const root = await executeTool('repo_list', { path: '.' });
  working.visited.lists.add('.');
  let latestEvidence = {
    kind: 'repo_orientation',
    source: { path: '.' },
    content: compactRepoList(root),
    instruction: 'Use this repository orientation to choose the first targeted search/read for the workflow.'
  };

  for (let round = 1; round <= MAX_WORKFLOW_ROUNDS; round += 1) {
    console.log(`[DataSong] ${task.id}: story round ${round}`);

    const response = await withTimeout(
      deepseek.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: workflowAssessmentInstructions(task) },
          { role: 'user', content: buildWorkflowTurnPrompt({ task, businessDescription, repoUrl, repoPreparation, working, latestEvidence }) }
        ],
        response_format: { type: 'json_object' },
        max_tokens: MAX_MODEL_TOKENS,
        temperature: 0
      }),
      MODEL_TIMEOUT_MS,
      `DeepSeek did not respond within ${Math.round(MODEL_TIMEOUT_MS / 1000)} seconds while assessing '${task.name}'`
    );

    addTokenUsage(tokenUsage, response.usage);
    printRoundUsage(task.id, round, response.usage, tokenUsage);

    const choice = response.choices?.[0];
    const content = choice?.message?.content;
    if (!content?.trim()) {
      latestEvidence = { kind: 'model_retry', content: 'The prior JSON response was empty. Reassess the workflow and return the required JSON object.' };
      continue;
    }

    let turn;
    try {
      turn = JSON.parse(content);
    } catch (error) {
      console.warn(`[DataSong] ${task.id}: invalid assessment JSON on round ${round}: ${error.message}`);
      latestEvidence = { kind: 'model_retry', content: 'The prior response was not valid JSON. Return one concise complete JSON object matching the required schema.' };
      continue;
    }

    working.storySummary = cleanText(turn.storySummary, 1800) || working.storySummary;
    working.checklist = normalizeChecklist(turn.checklist, working.checklist);
    addCompactFinding(working, turn.evidenceFinding, latestEvidence);

    const percent = checklistPercent(working.checklist);
    const gaps = remainingGaps(working.checklist);
    semanticStore.emit({
      type: 'workflow_assessment',
      workflowTaskId: task.id,
      percent,
      checklist: working.checklist,
      storySummary: working.storySummary,
      remainingGaps: gaps,
      message: assessmentProgressMessage(task, percent, gaps, working.storySummary)
    });
    broadcast();

    const action = normalizeNextAction(turn.nextAction);
    if (action.type === 'finish') {
      const gate = completionGate(working.checklist, turn.synthesis);
      if (!gate.ok) {
        latestEvidence = {
          kind: 'completion_rejected',
          content: `DataSong cannot finish yet: ${gate.reasons.join('; ')}. Resolve these gaps using new evidence, not previously visited source.`
        };
        continue;
      }

      recordSynthesis(task, turn.synthesis);
      await executeTool('semantic_finish_workflow', {
        workflowId: task.id,
        summary: cleanText(turn.completionReason, 800) || `Workflow story complete with ${percent}% structural coverage.`
      });
      semanticStore.emit({ type: 'workflow_assessment', workflowTaskId: task.id, percent: 100, checklist: working.checklist, storySummary: working.storySummary, remainingGaps: [], message: `Workflow story complete: ${task.name}.` });
      broadcast();
      return;
    }

    latestEvidence = await executeEvidenceAction(task, action, working);
  }

  throw new Error(`Workflow '${task.name}' did not reach structural completion within ${MAX_WORKFLOW_ROUNDS} story-assessment rounds`);
}

async function executeEvidenceAction(task, action, working) {
  if (action.type === 'search') {
    const key = normalizeKey(action.query);
    if (!key) return { kind: 'action_rejected', content: 'Search query was empty. Choose one specific unresolved workflow gap.' };
    if (working.visited.searches.has(key)) return blockedEvidence(task, working, `search '${action.query}'`, findingsForQuery(working, action.query));
    working.visited.searches.add(key);
    const result = await executeTool('repo_search', { query: action.query, maxResults: clamp(action.maxResults || 20, 1, 30) });
    semanticStore.emit({ type: 'tool_completed', tool: 'repo_search', args: action, workflowTaskId: task.id, resultPreview: preview(result) });
    broadcast();
    return { kind: 'repo_search', source: { query: action.query }, content: result };
  }

  if (action.type === 'list') {
    const path = normalizePath(action.path || '.');
    if (working.visited.lists.has(path)) return blockedEvidence(task, working, `directory '${path}'`, findingsForPath(working, path));
    working.visited.lists.add(path);
    const result = await executeTool('repo_list', { path });
    semanticStore.emit({ type: 'tool_completed', tool: 'repo_list', args: { path }, workflowTaskId: task.id, resultPreview: preview(result) });
    broadcast();
    return { kind: 'repo_list', source: { path }, content: compactRepoList(result) };
  }

  if (action.type === 'read') {
    const path = normalizePath(action.path);
    const startLine = Math.max(1, Number(action.startLine || 1));
    const endLine = Math.max(startLine, Math.min(startLine + 260, Number(action.endLine || startLine + 180)));
    const symbolKey = action.symbol ? `${path}#${normalizeKey(action.symbol)}` : null;
    if (symbolKey && working.visited.symbols.has(symbolKey)) return blockedEvidence(task, working, `symbol '${action.symbol}' in ${path}`, findingsForPath(working, path));
    if (rangeCovered(working.visited.ranges.get(path) || [], startLine, endLine)) return blockedEvidence(task, working, `${path}:${startLine}-${endLine}`, findingsForPath(working, path));

    addVisitedRange(working.visited.ranges, path, startLine, endLine);
    if (symbolKey) working.visited.symbols.add(symbolKey);
    const result = await executeTool('repo_read_file', { path, startLine, endLine });
    semanticStore.emit({ type: 'tool_completed', tool: 'repo_read_file', args: { path, startLine, endLine, symbol: action.symbol || null }, workflowTaskId: task.id, resultPreview: preview(result) });
    broadcast();
    return { kind: 'repo_read_file', source: { path, startLine, endLine, symbol: action.symbol || null }, content: result };
  }

  return { kind: 'action_rejected', content: `Unknown next action '${action.type}'. Choose search, read, list, or finish.` };
}

function blockedEvidence(task, working, label, priorFindings) {
  working.blockedRevisits += 1;
  semanticStore.emit({
    type: 'learning_update',
    workflowTaskId: task.id,
    message: `Skipped already investigated evidence (${label}); using the compact finding instead.`
  });
  broadcast();
  return {
    kind: 'already_visited',
    content: `DataSong has already investigated ${label} for this workflow. Do not request it again. Choose an unresolved gap or a different source branch.`,
    priorFindings: priorFindings.slice(-5)
  };
}

function buildWorkflowTurnPrompt({ task, businessDescription, repoUrl, repoPreparation, working, latestEvidence }) {
  return `Return JSON only. Reassess the ENTIRE workflow story on every turn.\n\nBUSINESS\n${businessDescription}\n\nREPOSITORY\n${repoUrl}\nCommit: ${repoPreparation.currentCommit}\nRoot tree: ${repoPreparation.rootTree}\nChanged areas relevant to review: ${JSON.stringify((repoPreparation.topLevelChangedAreas || []).slice(0, 10))}\nChanged evidence files for this task: ${JSON.stringify(task.changedEvidenceFiles || [])}\n\nWORKFLOW GOAL\n${task.name} (id: ${task.id})\nMode: ${task.mode}\n\nCURRENT COMPACT STORY\n${working.storySummary || '(none yet)'}\n\nCURRENT CHECKLIST\n${JSON.stringify(working.checklist)}\n\nCOMPACT EVIDENCE LEDGER\n${JSON.stringify(working.findings.slice(-MAX_COMPACT_FINDINGS))}\n\nVISITED LEDGER\n${JSON.stringify(compactVisited(working.visited))}\n\nLATEST EVIDENCE — EPHEMERAL, ANALYZE IT NOW\n${JSON.stringify(latestEvidence)}\n\nYour response must be one JSON object with this shape:\n${WORKFLOW_TURN_EXAMPLE}\n\nRules: update the whole-story checklist from all compact evidence plus the latest evidence; convert useful latest raw evidence into ONE compact evidenceFinding; identify remaining gaps; choose exactly ONE unvisited nextAction. Use finish only when the story is structurally complete and include synthesis.`;
}

const WORKFLOW_TURN_EXAMPLE = JSON.stringify({
  storySummary: 'Compact end-to-end story known so far.',
  checklist: {
    trigger: { status: 'supported', summary: 'What starts the workflow.' },
    actors: { status: 'partial', summary: 'Known actors.' },
    concepts: { status: 'supported', summary: 'Core business objects.' },
    steps: { status: 'partial', summary: 'Major steps known so far.' },
    rules: { status: 'missing', summary: 'Important branches still unknown.' },
    persistentReads: { status: 'partial', summary: 'Durable reads known.' },
    persistentWrites: { status: 'partial', summary: 'Durable writes known.' },
    outcome: { status: 'supported', summary: 'Recognizable outcome.' },
    nextWorkflow: { status: 'missing', summary: 'Direct handoff not yet proven.' },
    evidenceCoverage: { status: 'partial', summary: 'Evidence coverage assessment.' }
  },
  evidenceFinding: {
    source: { path: 'relative/file.xml', symbol: 'symbol', startLine: 10, endLine: 40 },
    finding: 'Short business meaning extracted from the latest evidence.',
    supports: ['steps', 'persistentWrites']
  },
  remainingGaps: ['One material story gap.'],
  nextAction: { type: 'search', query: 'targeted business or code term', maxResults: 20 },
  completionReason: '',
  synthesis: null
}, null, 2);

function workflowAssessmentInstructions(task) {
  return `You are DataSong's workflow story analyst. Work ONLY on '${task.name}' (${task.id}).\nA workflow is one end-to-end enterprise story slice from a business trigger to a recognizable customer/business outcome. Functions, services, helpers and branches are evidence inside a workflow, not workflows by themselves.\n\nEvery response MUST be valid JSON. Every turn, reassess the FULL story using the compact story, checklist, compact evidence ledger and latest ephemeral evidence.\nStatuses are exactly: missing, partial, supported, not_applicable. Use not_applicable only when evidence shows that story element genuinely does not apply.\nDo not invent evidence. Keep repository paths/symbols/line ranges in evidence findings.\nDo not ask to revisit a search, file range or symbol shown in the visited ledger.\nChoose exactly ONE next action: search, read, list, or finish.\nPrefer targeted search/read over broad listing.\nWhen latest raw source is useful, compress it into a short evidenceFinding; the raw source will NOT be retained in later turns.\nThe story is complete only when trigger, actors, concepts, major steps, material rules, persistence behavior, outcome, direct handoff if applicable, and evidence coverage are accounted for.\nOn finish, synthesis must contain canonical concepts, rules, persistent data, relations and the complete workflow. Never finish merely because many files were read.`;
}

function recordSynthesis(task, synthesis = {}) {
  const concepts = Array.isArray(synthesis.concepts) ? synthesis.concepts : [];
  const rules = Array.isArray(synthesis.rules) ? synthesis.rules : [];
  const persistentData = Array.isArray(synthesis.persistentData) ? synthesis.persistentData : [];
  const relations = Array.isArray(synthesis.relations) ? synthesis.relations : [];
  const workflow = synthesis.workflow || {};

  for (const item of concepts) {
    if (!item?.id || !item?.label) continue;
    executeToolSync('semantic_record_node', {
      id: item.id,
      label: item.label,
      kind: 'business_concept',
      description: item.description || item.label,
      technicalNames: item.technicalNames || [],
      evidence: item.evidence || []
    });
  }

  for (const item of rules) {
    if (!item?.id || !item?.label) continue;
    executeToolSync('semantic_record_condition', {
      id: item.id,
      workflowId: task.id,
      label: item.label,
      expression: item.expression || '',
      driver: ['config', 'data', 'runtime', 'unknown'].includes(item.driver) ? item.driver : 'unknown',
      truePath: item.truePath || '',
      falsePath: item.falsePath || '',
      technicalNames: item.technicalNames || [],
      evidence: item.evidence || []
    });
  }

  for (const item of persistentData) {
    if (!item?.id || !item?.businessLabel || !item?.technicalName) continue;
    executeToolSync('semantic_record_persistent_data', {
      id: item.id,
      businessLabel: item.businessLabel,
      technicalName: item.technicalName,
      store: item.store || 'application datastore',
      operation: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'READ_WRITE'].includes(item.operation) ? item.operation : 'READ_WRITE',
      fields: item.fields || [],
      workflowId: task.id,
      description: item.description || item.businessLabel,
      evidence: item.evidence || []
    });
  }

  executeToolSync('semantic_record_workflow', {
    id: task.id,
    name: workflow.name || task.name,
    trigger: workflow.trigger || '',
    outcome: workflow.outcome || '',
    description: workflow.description || '',
    conceptIds: workflow.conceptIds || concepts.map((item) => item.id).filter(Boolean),
    ruleIds: workflow.ruleIds || rules.map((item) => item.id).filter(Boolean),
    nextWorkflowIds: workflow.nextWorkflowIds || [],
    technicalNames: workflow.technicalNames || [],
    evidence: workflow.evidence || []
  });

  for (const item of relations) {
    if (!item?.source || !item?.target || !item?.relation) continue;
    executeToolSync('semantic_record_relation', {
      source: item.source,
      target: item.target,
      relation: item.relation,
      confidence: Number.isFinite(item.confidence) ? item.confidence : 0.9,
      evidence: item.evidence || []
    });
  }
}

function executeToolSync(name, args) {
  const promise = executeTool(name, args);
  if (promise && typeof promise.then === 'function') {
    promise.catch((error) => console.error(`[DataSong] semantic write ${name} failed: ${error.message}`));
  }
}

function completionGate(checklist, synthesis) {
  const reasons = [];
  const required = ['trigger', 'actors', 'concepts', 'steps', 'rules', 'persistentReads', 'persistentWrites', 'outcome', 'nextWorkflow', 'evidenceCoverage'];
  for (const key of required) {
    const status = checklist?.[key]?.status;
    if (!['supported', 'not_applicable'].includes(status)) reasons.push(`${key} is ${status || 'missing'}`);
  }
  if (checklist?.evidenceCoverage?.status !== 'supported') reasons.push('evidenceCoverage must be supported');
  if (!synthesis?.workflow) reasons.push('final workflow synthesis is missing');
  if (!synthesis?.workflow?.trigger) reasons.push('workflow trigger is missing');
  if (!synthesis?.workflow?.outcome) reasons.push('workflow outcome is missing');
  if (!synthesis?.workflow?.description) reasons.push('workflow narrative is missing');
  return { ok: reasons.length === 0, reasons };
}

function emptyChecklist() {
  return Object.fromEntries(Object.keys(STORY_WEIGHTS).map((key) => [key, { status: 'missing', summary: '' }]));
}

function normalizeChecklist(input, previous) {
  const output = {};
  for (const key of Object.keys(STORY_WEIGHTS)) {
    const candidate = input?.[key] || previous?.[key] || {};
    const status = ['missing', 'partial', 'supported', 'not_applicable'].includes(candidate.status) ? candidate.status : (previous?.[key]?.status || 'missing');
    output[key] = { status, summary: cleanText(candidate.summary, 500) || previous?.[key]?.summary || '' };
  }
  return output;
}

function checklistPercent(checklist) {
  let score = 0;
  for (const [key, weight] of Object.entries(STORY_WEIGHTS)) {
    const status = checklist?.[key]?.status || 'missing';
    const factor = status === 'supported' || status === 'not_applicable' ? 1 : status === 'partial' ? 0.5 : 0;
    score += weight * factor;
  }
  return Math.round(score);
}

function remainingGaps(checklist) {
  return Object.entries(checklist || {})
    .filter(([, value]) => !['supported', 'not_applicable'].includes(value.status))
    .map(([key, value]) => `${humanizeKey(key)}: ${value.summary || value.status}`);
}

function assessmentProgressMessage(task, percent, gaps, storySummary) {
  if (!gaps.length) return `${task.name}: the end-to-end story is structurally complete; validating final synthesis.`;
  const focus = gaps.slice(0, 2).join(' · ');
  return `${task.name}: ${percent}% story coverage. ${focus}${storySummary ? '' : ' Building the first coherent story.'}`;
}

function addCompactFinding(working, finding, latestEvidence) {
  if (!finding?.finding) return;
  const source = finding.source || latestEvidence?.source || {};
  const item = {
    source: {
      path: source.path || null,
      symbol: source.symbol || null,
      startLine: source.startLine || null,
      endLine: source.endLine || null,
      query: source.query || null
    },
    finding: cleanText(finding.finding, 700),
    supports: Array.isArray(finding.supports) ? finding.supports.filter((key) => key in STORY_WEIGHTS) : []
  };
  const key = JSON.stringify(item);
  if (!working.findings.some((existing) => JSON.stringify(existing) === key)) working.findings.push(item);
  if (working.findings.length > MAX_COMPACT_FINDINGS) working.findings.splice(0, working.findings.length - MAX_COMPACT_FINDINGS);
  if (item.source.path && item.source.symbol) working.visited.symbols.add(`${normalizePath(item.source.path)}#${normalizeKey(item.source.symbol)}`);
}

function normalizeNextAction(action = {}) {
  const type = ['search', 'read', 'list', 'finish'].includes(action.type) ? action.type : 'search';
  return { ...action, type };
}

function compactVisited(visited) {
  return {
    searches: [...visited.searches].slice(-40),
    lists: [...visited.lists].slice(-30),
    ranges: [...visited.ranges.entries()].slice(-40).map(([path, ranges]) => ({ path, ranges })),
    symbols: [...visited.symbols].slice(-40)
  };
}

function rangeCovered(ranges, start, end) {
  return ranges.some(([from, to]) => start >= from && end <= to);
}

function addVisitedRange(map, path, start, end) {
  const ranges = map.get(path) || [];
  ranges.push([start, end]);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const current of ranges) {
    const last = merged[merged.length - 1];
    if (last && current[0] <= last[1] + 1) last[1] = Math.max(last[1], current[1]);
    else merged.push([...current]);
  }
  map.set(path, merged);
}

function findingsForPath(working, path) {
  const normalized = normalizePath(path);
  return working.findings.filter((item) => normalizePath(item.source?.path || '') === normalized);
}

function findingsForQuery(working, query) {
  const needle = normalizeKey(query);
  return working.findings.filter((item) => normalizeKey(item.source?.query || '').includes(needle) || normalizeKey(item.finding).includes(needle));
}

function relevantKnowledge(workflowId) {
  const state = semanticStore.snapshot();
  const workflow = state.workflows.find((item) => item.id === workflowId) || null;
  if (!workflow) return { workflow: null, adjacent: [] };
  const ids = new Set();
  for (const edge of state.edges) {
    if (edge.source === workflowId) ids.add(edge.target);
    if (edge.target === workflowId) ids.add(edge.source);
  }
  return { workflow, adjacent: state.nodes.filter((node) => ids.has(node.id)).slice(0, 30) };
}

function compactRepoList(result) {
  if (!Array.isArray(result)) return result;
  return result.slice(0, 120).map(({ name, path, type }) => ({ name, path, type }));
}

function assessmentMessage(repo) {
  if (!repo.previousCommit) return `Git assessment complete at ${shortSha(repo.currentCommit)}. First semantic scan; root tree ${shortSha(repo.rootTree)}.`;
  if (!repo.commitChanged) return `Git assessment complete. Repository and root tree are unchanged at ${shortSha(repo.currentCommit)}; validated workflows can be reused.`;
  if (!repo.comparisonAvailable) return 'Git assessment could not prove the prior tree diff, so workflows will be reviewed conservatively.';
  const areas = (repo.topLevelChangedAreas || []).slice(0, 4).map((area) => area.path).join(', ');
  return `Git assessment complete: ${repo.changedFiles?.length || 0} files and ${repo.changedTrees?.length || 0} affected directory trees${areas ? ` across ${areas}` : ''}.`;
}

function emptyTokenUsage() {
  return { prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0, reasoning: 0, requests: 0 };
}

function addTokenUsage(total, usage = {}) {
  total.prompt += Number(usage?.prompt_tokens || 0);
  total.completion += Number(usage?.completion_tokens || 0);
  total.total += Number(usage?.total_tokens || 0);
  total.cacheHit += Number(usage?.prompt_cache_hit_tokens || 0);
  total.cacheMiss += Number(usage?.prompt_cache_miss_tokens || 0);
  total.reasoning += Number(usage?.completion_tokens_details?.reasoning_tokens || 0);
  total.requests += 1;
}

function printRoundUsage(workflowId, round, usage = {}, cumulative) {
  const prompt = Number(usage?.prompt_tokens || 0);
  const completion = Number(usage?.completion_tokens || 0);
  const total = Number(usage?.total_tokens || prompt + completion);
  const hit = Number(usage?.prompt_cache_hit_tokens || 0);
  const miss = Number(usage?.prompt_cache_miss_tokens || 0);
  const reasoning = Number(usage?.completion_tokens_details?.reasoning_tokens || 0);
  console.log(`[DataSong] tokens ${workflowId} round ${round}: prompt=${prompt} completion=${completion} total=${total} cacheHit=${hit} cacheMiss=${miss}${reasoning ? ` reasoning=${reasoning}` : ''}`);
  console.log(`[DataSong] tokens cumulative: requests=${cumulative.requests} prompt=${cumulative.prompt} completion=${cumulative.completion} total=${cumulative.total} cacheHit=${cumulative.cacheHit} cacheMiss=${cumulative.cacheMiss}${cumulative.reasoning ? ` reasoning=${cumulative.reasoning}` : ''}`);
}

function printTokenSummary(usage) {
  console.log(`[DataSong] TOKEN SUMMARY: requests=${usage.requests} prompt=${usage.prompt} completion=${usage.completion} total=${usage.total} cacheHit=${usage.cacheHit} cacheMiss=${usage.cacheMiss}${usage.reasoning ? ` reasoning=${usage.reasoning}` : ''}`);
}

function normalizePath(value = '') { return String(value || '.').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '') || '.'; }
function normalizeKey(value = '') { return String(value).trim().toLowerCase().replace(/\s+/g, ' '); }
function humanizeKey(value = '') { return String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase(); }
function cleanText(value, max) { const text = typeof value === 'string' ? value.trim() : ''; return text.length > max ? `${text.slice(0, max)}…` : text; }
function shortSha(value = '') { return value ? String(value).slice(0, 8) : 'unknown'; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || min)); }
function withTimeout(promise, ms, message) { let timer; const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }); return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)); }
function preview(value) { const text = JSON.stringify(value); return text.length > 900 ? `${text.slice(0, 900)}…` : text; }
function broadcast() { const payload = `data: ${JSON.stringify({ type: 'snapshot', state: semanticStore.snapshot() })}\n\n`; for (const client of clients) client.write(payload); }

app.listen(port, () => {
  console.log(`DataSong demo server listening on http://localhost:${port}`);
  console.log(`Model: ${model} via DeepSeek API`);
  console.log(`Workflow mode: compact story assessment; raw repo evidence is ephemeral.`);
});
