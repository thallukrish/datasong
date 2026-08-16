import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { modelTools, executeTool } from './modelTools.js';
import { semanticStore } from './store.js';

const app = express();
const port = Number(process.env.PORT || 3101);
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const MODEL_TIMEOUT_MS = 45_000;
const MAX_MODEL_TOKENS = 1200;
const MAX_WORKFLOW_ROUNDS = 18;
const EVIDENCE_SYNTHESIS_ROUNDS = 6;
const deepseek = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com', timeout: MODEL_TIMEOUT_MS })
  : null;
const clients = new Set();

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
  semanticStore.emit({ type: 'tool_started', tool: 'repo_prepare', args: { repoUrl }, message: 'Assessing repository changes from the Git tree…' });
  broadcast();
  const repoPreparation = await executeTool('repo_prepare', { repoUrl });
  semanticStore.emit({ type: 'tool_completed', tool: 'repo_prepare', args: { repoUrl }, resultPreview: preview(repoPreparation) });
  semanticStore.emit({ type: 'learning_update', message: assessmentMessage(repoPreparation) });
  broadcast();

  const plan = repoPreparation.workflowPlan;
  const pending = plan.tasks.filter((task) => task.status === 'pending');
  if (!pending.length) {
    semanticStore.complete(`Repository synchronized. ${plan.reusedWorkflows} known workflow${plan.reusedWorkflows === 1 ? '' : 's'} reused because their supporting source did not change.`);
    broadcast();
    return;
  }

  for (const task of pending) {
    semanticStore.startWorkflowTask(task.id);
    semanticStore.emit({ type: 'learning_update', message: `${task.mode === 'review' ? 'Rechecking' : 'Learning'} end-to-end workflow: ${task.name}.` });
    broadcast();
    await exploreWorkflow({ task, businessDescription, repoUrl, repoPreparation, priorKnowledge });
  }

  const finished = semanticStore.workflowPlan();
  semanticStore.complete(`Repository synchronized at ${shortSha(repoPreparation.currentCommit)}. Completed ${finished.completedWorkflows} workflow task${finished.completedWorkflows === 1 ? '' : 's'} and reused ${finished.reusedWorkflows} unchanged workflow${finished.reusedWorkflows === 1 ? '' : 's'}.`);
  broadcast();
}

async function exploreWorkflow({ task, businessDescription, repoUrl, repoPreparation, priorKnowledge }) {
  const existingWorkflow = priorKnowledge.workflows?.find((workflow) => workflow.id === task.id) || null;
  const tools = toChatCompletionTools(modelTools.filter((tool) => !['repo_prepare', 'semantic_complete'].includes(tool.name)));
  const messages = [
    { role: 'system', content: workflowInstructions(task) },
    {
      role: 'user',
      content: `Business description:\n${businessDescription}\n\nRepository:\n${repoUrl}\n\nCURRENT WORKFLOW TASK:\n${JSON.stringify(task, null, 2)}\n\nExisting workflow knowledge, if any:\n${JSON.stringify(existingWorkflow, null, 2)}\n\nKnown canonical knowledge you may reuse:\n${JSON.stringify(priorKnowledge, null, 2)}\n\nGit change assessment:\n${JSON.stringify({ currentCommit: repoPreparation.currentCommit, rootTree: repoPreparation.rootTree, changedFiles: repoPreparation.changedFiles, changedTrees: repoPreparation.changedTrees, topLevelChangedAreas: repoPreparation.topLevelChangedAreas }, null, 2)}\n\nWork ONLY on the current workflow. Search/read narrowly, record its concepts/rules/data/relationships, record the complete workflow using id '${task.id}', then call semantic_finish_workflow for '${task.id}'.`
    }
  ];

  let evidenceOnlyRounds = 0;
  const seenOperations = new Set();

  for (let round = 1; round <= MAX_WORKFLOW_ROUNDS; round += 1) {
    console.log(`[DataSong] ${task.id}: DeepSeek round ${round}`);
    const response = await withTimeout(
      deepseek.chat.completions.create({ model, messages, tools, tool_choice: 'auto', max_tokens: MAX_MODEL_TOKENS, temperature: 0 }),
      MODEL_TIMEOUT_MS,
      `DeepSeek did not respond within ${Math.round(MODEL_TIMEOUT_MS / 1000)} seconds while working on '${task.name}'`
    );
    const message = response.choices?.[0]?.message;
    if (!message) throw new Error(`DeepSeek returned no assistant message while working on '${task.name}'`);
    const calls = message.tool_calls || [];
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });

    if (!calls.length) {
      messages.push({ role: 'user', content: `You have not finished the workflow task. Record supported semantic knowledge and call semantic_finish_workflow for '${task.id}'. Do not answer in prose instead of finishing the task.` });
      continue;
    }

    let semanticWrites = 0;
    let novelEvidenceOps = 0;
    for (const call of calls) {
      const name = call.function?.name;
      let args;
      try { args = JSON.parse(call.function?.arguments || '{}'); }
      catch { throw new Error(`DeepSeek returned invalid JSON arguments for ${name || 'a tool'} while working on '${task.name}'`); }
      if (name === 'semantic_record_workflow') args.id = task.id;
      if (name === 'semantic_finish_workflow') args.workflowId = task.id;

      const operationKey = `${name}:${JSON.stringify(args)}`;
      if (['repo_search', 'repo_read_file', 'repo_list'].includes(name) && !seenOperations.has(operationKey)) novelEvidenceOps += 1;
      seenOperations.add(operationKey);

      semanticStore.emit({ type: 'tool_started', tool: name, args, workflowTaskId: task.id, message: toolProgressText(name, args, task) });
      broadcast();
      const result = await executeTool(name, args);
      semanticStore.emit({ type: 'tool_completed', tool: name, args, workflowTaskId: task.id, resultPreview: preview(result) });
      const learned = learningMessage(name, args, result);
      if (learned) semanticStore.emit({ type: 'learning_update', workflowTaskId: task.id, message: learned });
      if (isSemanticWrite(name)) semanticWrites += 1;
      broadcast();
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }

    const plan = semanticStore.workflowPlan();
    if (plan.tasks.find((item) => item.id === task.id)?.status === 'complete') return;
    if (semanticWrites > 0) evidenceOnlyRounds = 0;
    else if (novelEvidenceOps > 0) evidenceOnlyRounds += 1;
    else evidenceOnlyRounds += 2;

    if (evidenceOnlyRounds >= EVIDENCE_SYNTHESIS_ROUNDS) {
      messages.push({ role: 'user', content: `You have gathered enough evidence for '${task.name}' without completing it. Stop broad searching. Synthesize the evidence into concepts, rules, persistent data and relations, record workflow '${task.id}', then call semantic_finish_workflow. Only read one more file if one specific missing fact prevents completion.` });
      semanticStore.emit({ type: 'learning_update', workflowTaskId: task.id, message: `Evidence gathered for ${task.name}. Synthesizing the workflow now.` });
      broadcast();
      evidenceOnlyRounds = 0;
    }
  }
  throw new Error(`Workflow '${task.name}' did not complete within ${MAX_WORKFLOW_ROUNDS} bounded model rounds`);
}

function workflowInstructions(task) {
  return `You are DataSong's bounded workflow analyst. Your ONLY task is '${task.name}' (id '${task.id}').
A workflow is one end-to-end enterprise story slice accomplishing ONE concrete customer/business use case, from business trigger to recognizable outcome. Functions, services, helpers and branches are not workflows by themselves.
1. Inspect only source needed for this workflow.
2. Reuse canonical business concepts; do not create synonyms.
3. Record immediate concepts, rules, durable data and relationships as evidence supports them.
4. Keep runtime/service/function names in technicalNames/evidence.
5. Persistent data and conditions must attach to workflowId '${task.id}'.
6. Record semantic_record_workflow with EXACT id '${task.id}', trigger, outcome, conceptIds, ruleIds and nextWorkflowIds.
7. Next workflows must be direct handoffs/triggers.
8. Never invent evidence; use repository-relative source locations.
9. When complete, call semantic_finish_workflow. Do not explore another workflow.
${task.mode === 'review' ? '10. This is a review caused by source changes. Prefer changed evidence and preserve unchanged facts.' : ''}`;
}

function assessmentMessage(repo) {
  if (!repo.previousCommit) return `Git assessment complete at ${shortSha(repo.currentCommit)}. First semantic scan; root tree ${shortSha(repo.rootTree)}.`;
  if (!repo.commitChanged) return `Git assessment complete. Repository and root tree are unchanged at ${shortSha(repo.currentCommit)}; validated workflows can be reused.`;
  if (!repo.comparisonAvailable) return 'Git assessment could not prove the prior tree diff, so workflows will be reviewed conservatively.';
  const areas = (repo.topLevelChangedAreas || []).slice(0, 4).map((area) => area.path).join(', ');
  return `Git assessment complete: ${repo.changedFiles?.length || 0} files and ${repo.changedTrees?.length || 0} directory trees changed${areas ? ` across ${areas}` : ''}.`;
}

function toolProgressText(name, args, task) {
  if (name === 'repo_list') return `Mapping the source area for ${task.name}…`;
  if (name === 'repo_search') return `Looking for evidence about ${humanizeQuery(args.query)} in ${task.name}…`;
  if (name === 'repo_read_file') return `Reading ${shortPath(args.path)} for ${task.name}…`;
  if (name === 'semantic_record_workflow') return `Writing the end-to-end workflow: ${task.name}…`;
  if (name === 'semantic_record_node') return `Learned a concept in ${task.name}: ${args.label || 'business concept'}…`;
  if (name === 'semantic_record_relation') return `Connecting business knowledge inside ${task.name}…`;
  if (name === 'semantic_record_persistent_data') return `Tracing durable data for ${task.name}: ${args.businessLabel || 'business data'}…`;
  if (name === 'semantic_record_condition') return `Capturing rule in ${task.name}: ${args.label || 'business rule'}…`;
  if (name === 'semantic_finish_workflow') return `Finishing workflow: ${task.name}…`;
  return `Working on ${task.name}…`;
}

function learningMessage(name, args, result) {
  if (name === 'repo_search') { const count = Array.isArray(result) ? result.length : 0; return count ? `Found ${count} source clue${count === 1 ? '' : 's'} about ${humanizeQuery(args.query)}.` : null; }
  if (name === 'repo_read_file') return `Found source evidence in ${shortPath(args.path)}.`;
  if (name === 'semantic_record_workflow') return `Learned end-to-end flow: ${args.name} — ${args.outcome}`;
  if (name === 'semantic_record_node') return `Learned what ${args.label} means in the business.`;
  if (name === 'semantic_record_relation') { const snapshot = semanticStore.snapshot(); const source = snapshot.nodes.find((node) => node.id === args.source)?.label || args.source; const target = snapshot.nodes.find((node) => node.id === args.target)?.label || args.target; return `Learned: ${source} ${args.relation} ${target}.`; }
  if (name === 'semantic_record_persistent_data') return `Learned where ${args.businessLabel} is persisted: ${args.technicalName}.`;
  if (name === 'semantic_record_condition') return `Learned business rule: ${args.label}`;
  if (name === 'semantic_finish_workflow') return result?.message || `Completed workflow ${args.workflowId}.`;
  return null;
}

function isSemanticWrite(name = '') { return name.startsWith('semantic_record_') || name === 'semantic_finish_workflow'; }
function humanizeQuery(query = '') { return String(query).replace(/[#_]/g, ' ').trim() || 'the next business step'; }
function shortPath(file = '') { const parts = String(file).split('/'); return parts[parts.length - 1] || 'this source file'; }
function shortSha(value = '') { return value ? String(value).slice(0, 8) : 'unknown'; }
function toChatCompletionTools(tools) { return tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })); }
function withTimeout(promise, ms, message) { let timer; const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }); return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)); }
function preview(value) { const text = JSON.stringify(value); return text.length > 900 ? `${text.slice(0, 900)}…` : text; }
function broadcast() { const payload = `data: ${JSON.stringify({ type: 'snapshot', state: semanticStore.snapshot() })}\n\n`; for (const client of clients) client.write(payload); }

app.listen(port, () => {
  console.log(`DataSong demo server listening on http://localhost:${port}`);
  console.log(`Model: ${model} via DeepSeek API`);
});
