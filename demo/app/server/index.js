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
const RETRY_MODEL_TOKENS = 6000;
const MAX_WORKFLOW_ROUNDS = 24;
const MAX_COMPACT_FINDINGS = 24;
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
  let retryNote = '';
  let nextTokenLimit = MAX_MODEL_TOKENS;

  for (let round = 1; round <= MAX_WORKFLOW_ROUNDS; round += 1) {
    console.log(`[DataSong] ${task.id}: story round ${round}${retryNote ? ' (retrying same evidence)' : ''}`);

    const response = await withTimeout(
      deepseek.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: workflowAssessmentInstructions(task) },
          { role: 'user', content: buildWorkflowTurnPrompt({ task, businessDescription, repoUrl, repoPreparation, working, latestEvidence, retryNote }) }
        ],
        response_format: { type: 'json_object' },
        max_tokens: nextTokenLimit,
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
      retryNote = 'Your previous response was empty. Reprocess the SAME latest evidence. Return a very concise complete JSON object; do not add prose.';
      nextTokenLimit = RETRY_MODEL_TOKENS;
      continue;
    }

    let turn;
    try {
      turn = JSON.parse(content);
    } catch (error) {
      console.warn(`[DataSong] ${task.id}: invalid assessment JSON on round ${round}: ${error.message}; finish=${choice?.finish_reason || 'unknown'}`);
      retryNote = choice?.finish_reason === 'length'
        ? 'Your previous response hit the output limit and was truncated. Reprocess the SAME latest evidence. Be terse: storySummary <= 500 chars, every checklist summary <= 120 chars, evidenceFinding <= 250 chars, progressMessage <= 180 chars. Return complete JSON before elaborating.'
        : 'Your previous response was invalid JSON. Reprocess the SAME latest evidence and return one terse complete JSON object only.';
      nextTokenLimit = RETRY_MODEL_TOKENS;
      semanticStore.emit({
        type: 'learning_update',
        workflowTaskId: task.id,
        message: `Keeping the latest source evidence and retrying its interpretation for ${task.name}.`
      });
      broadcast();
      continue;
    }

    retryNote = '';
    nextTokenLimit = MAX_MODEL_TOKENS;
    working.storySummary = cleanText(turn.storySummary, 700) || working.storySummary;
    working.checklist = normalizeChecklist(turn.checklist, working.checklist);
    const newFinding = addCompactFinding(working, turn.evidenceFinding, latestEvidence);
    const action = normalizeNextAction(turn.nextAction);

    const percent = checklistPercent(working.checklist);
    const gaps = remainingGaps(working.checklist);
    semanticStore.emit({
      type: 'workflow_assessment',
      workflowTaskId: task.id,
      percent,
      checklist: working.checklist,
      storySummary: working.storySummary,
      remainingGaps: gaps,
      latestFinding: newFinding,
      message: findingProgressMessage(task, turn.progressMessage, newFinding, working.findings, action)
    });
    broadcast();

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
      semanticStore.emit({ type: 'workflow_assessment', workflowTaskId: task.id, percent: 100, checklist: working.checklist, storySummary: working.storySummary, remainingGaps: [], message: finalFindingMessage(task, working.findings) });
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
    message: `Already traced ${label}; following another part of the ${task.name.toLowerCase()} story instead.`
  });
  broadcast();
  return {
    kind: 'already_visited',
    content: `DataSong has already investigated ${label} for this workflow. Do not request it again. Choose an unresolved gap or a different source branch.`,
    priorFindings: priorFindings.slice(-5)
  };
}

function buildWorkflowTurnPrompt({ task, businessDescription, repoUrl, repoPreparation, working, latestEvidence, retryNote = '' }) {
  return `BUSINESS\n${businessDescription}\n\nREPOSITORY\n${repoUrl}\nCommit: ${repoPreparation.currentCommit}\nChanged areas relevant to review: ${JSON.stringify((repoPreparation.topLevelChangedAreas || []).slice(0, 8))}\nChanged evidence files for this task: ${JSON.stringify(task.changedEvidenceFiles || [])}\n\nWORKFLOW GOAL\n${task.name} (id: ${task.id})\nMode: ${task.mode}\n\nCURRENT COMPACT STORY\n${working.storySummary || '(none yet)'}\n\nCURRENT CHECKLIST\n${JSON.stringify(working.checklist)}\n\nCOMPACT EVIDENCE LEDGER\n${JSON.stringify(working.findings.slice(-MAX_COMPACT_FINDINGS))}\n\nVISITED LEDGER\n${JSON.stringify(compactVisited(working.visited))}${retryNote ? `\n\nRETRY REQUIREMENT\n${retryNote}` : ''}\n\nLATEST EVIDENCE — EPHEMERAL, ANALYZE IT NOW\n${JSON.stringify(latestEvidence)}`;
}

const WORKFLOW_TURN_EXAMPLE = JSON.stringify({
  storySummary: 'Brief coherent story so far, maximum about 500 characters.',
  checklist: {
    trigger: { status: 'supported', summary: 'brief evidence-based note' },
    actors: { status: 'partial', summary: 'brief evidence-based note' },
    concepts: { status: 'supported', summary: 'brief evidence-based note' },
    steps: { status: 'partial', summary: 'brief evidence-based note' },
    rules: { status: 'missing', summary: 'brief evidence-based note' },
    persistentReads: { status: 'partial', summary: 'brief evidence-based note' },
    persistentWrites: { status: 'partial', summary: 'brief evidence-based note' },
    outcome: { status: 'supported', summary: 'brief evidence-based note' },
    nextWorkflow: { status: 'missing', summary: 'brief evidence-based note' },
    evidenceCoverage: { status: 'partial', summary: 'brief evidence-based note' }
  },
  evidenceFinding: {
    source: { path: 'relative/file.xml', symbol: 'symbol', startLine: 10, endLine: 40 },
    finding: 'One short business meaning extracted from the latest evidence.',
    supports: ['steps', 'persistentWrites']
  },
  progressMessage: 'Found the Place Order action calling the order service; following that service into the persisted order data.',
  nextAction: { type: 'search', query: 'one targeted code or business term', maxResults: 20 },
  completionReason: '',
  synthesis: null
});

function workflowAssessmentInstructions(task) {
  return `You are DataSong's workflow story analyst. Work ONLY on '${task.name}' (${task.id}).\nA workflow is one end-to-end enterprise story slice from a business trigger to a recognizable customer/business outcome. Functions, services, helpers and branches are evidence inside a workflow, not workflows by themselves.\n\nReturn JSON only. Reassess the ENTIRE workflow story on every turn. Keep the response compact.\nEvery response MUST be valid JSON and concise. Every turn, reassess the FULL story using the compact story, checklist, compact evidence ledger and latest ephemeral evidence.\nStatuses are exactly: missing, partial, supported, not_applicable. Use not_applicable only when evidence proves the element does not apply.\nKeep storySummary <= 500 characters. Keep each checklist summary <= 120 characters. Keep evidenceFinding.finding <= 250 characters. Keep progressMessage <= 180 characters.\nDo not invent evidence. Keep repository paths/symbols/line ranges in evidence findings.\nDo not revisit a search, file range or symbol shown in the visited ledger.\nChoose exactly ONE next action: search, read, list, or finish. Prefer targeted search/read over broad listing.\nprogressMessage is shown to a human. It MUST describe what was just found or connected in business language and, optionally, what thread is being followed next. Never mention checklist categories, percentages, coverage, missing actors/concepts/rules/triggers, or internal assessment mechanics.\nWhen latest raw source is useful, compress it into a short evidenceFinding; the raw source will NOT be retained after a successful turn.\nThe story is complete only when the end-to-end path, material decisions, persistence behavior, outcome and direct handoff are accounted for.\nOn finish, synthesis must contain canonical concepts, rules, persistent data, relations and the complete workflow. Never finish merely because many files were read.\n\nSTATIC RESPONSE SHAPE — use this exact structure every turn:\n${WORKFLOW_TURN_EXAMPLE}\n\nUpdate the whole story checklist from accumulated compact evidence plus the latest evidence; compress useful latest evidence into ONE short evidenceFinding; choose exactly ONE unvisited nextAction. Use finish only when structurally complete and include synthesis.`;
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
    output[key] = { status, summary: cleanText(candidate.summary, 160) || previous?.[key]?.summary || '' };
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

function findingProgressMessage(task, modelMessage, newFinding, findings, action) {
  const explicit = cleanText(modelMessage, 220);
  if (explicit && !looksLikeAssessmentRubric(explicit)) return explicit;
  const finding = newFinding?.finding || findings.at(-1)?.finding;
  if (finding) return `${sentence(finding)}${nextThreadText(action)}`;
  if (action.type === 'search' && action.query) return `Following the ${task.name.toLowerCase()} path through ${humanizeQuery(action.query)}…`;
  if (action.type === 'read' && action.path) return `Following the ${task.name.toLowerCase()} path into ${shortPath(action.path)}…`;
  return `Connecting the next part of ${task.name.toLowerCase()}…`;
}

function finalFindingMessage(task, findings) {
  const last = findings.at(-1)?.finding;
  return last ? `${sentence(last)} The ${task.name.toLowerCase()} story is now connected end to end.` : `${task.name} is now connected end to end.`;
}

function looksLikeAssessmentRubric(text) {
  return /\b(story coverage|checklist|missing actors?|missing concepts?|missing rules?|missing trigger|evidence coverage|percent|percentage)\b/i.test(text);
}

function nextThreadText(action = {}) {
  if (action.type === 'search' && action.query) return ` Following ${humanizeQuery(action.query)} next.`;
  if (action.type === 'read' && action.path) return ` Following that into ${shortPath(action.path)} next.`;
  if (action.type === 'list' && action.path) return ` Opening ${shortPath(action.path)} next.`;
  return '';
}

function addCompactFinding(working, finding, latestEvidence) {
  if (!finding?.finding) return null;
  const source = finding.source || latestEvidence?.source || {};
  const item = {
    source: {
      path: source.path || null,
      symbol: source.symbol || null,
      startLine: source.startLine || null,
      endLine: source.endLine || null,
      query: source.query || null
    },
    finding: cleanText(finding.finding, 350),
    supports: Array.isArray(finding.supports) ? finding.supports.filter((key) => key in STORY_WEIGHTS) : []
  };
  const key = JSON.stringify(item);
  if (!working.findings.some((existing) => JSON.stringify(existing) === key)) working.findings.push(item);
  if (working.findings.length > MAX_COMPACT_FINDINGS) working.findings.splice(0, working.findings.length - MAX_COMPACT_FINDINGS);
  if (item.source.path && item.source.symbol) working.visited.symbols.add(`${normalizePath(item.source.path)}#${normalizeKey(item.source.symbol)}`);
  return item;
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
function humanizeQuery(value = '') { return String(value).replace(/[#_]/g, ' ').replace(/\s+/g, ' ').trim() || 'the next order step'; }
function shortPath(value = '') { const parts = String(value).split('/').filter(Boolean); return parts.at(-1) || 'the next source area'; }
function sentence(value = '') { const text = cleanText(value, 260); return /[.!?]$/.test(text) ? text : `${text}.`; }
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