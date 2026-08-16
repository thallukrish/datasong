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
const STAGNATION_RECOVERY_ROUNDS = 3;
const STAGNATION_STOP_ROUNDS = 5;
const deepseek = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
      timeout: MODEL_TIMEOUT_MS
    })
  : null;
const clients = new Set();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/state', (_req, res) => res.json(semanticStore.snapshot()));

app.post('/api/reset', (_req, res) => {
  semanticStore.reset();
  broadcast();
  res.json({ ok: true });
});

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
  semanticStore.emit({
    type: 'tool_started',
    tool: 'repo_prepare',
    args: { repoUrl },
    message: 'Checking the repository version and what DataSong can safely reuse…'
  });
  broadcast();

  const repoPreparation = await executeTool('repo_prepare', { repoUrl });
  semanticStore.emit({
    type: 'tool_completed',
    tool: 'repo_prepare',
    args: { repoUrl },
    resultPreview: preview(repoPreparation)
  });
  semanticStore.emit({
    type: 'learning_update',
    message: repoPreparation.currentCommit === repoPreparation.previousCommit
      ? 'The source has not changed. Reusing the business knowledge already validated against this commit.'
      : repoPreparation.previousCommit
        ? `The source changed in ${repoPreparation.changedFiles?.length || 0} file(s). Rechecking only the affected business knowledge.`
        : 'No prior source version was available. Building the first validated business guide for this repository.'
  });
  broadcast();

  const instructions = `
You are DataSong examining how a business works by reading its application repository.

DataSong builds a browsable enterprise story. The fundamental unit called a WORKFLOW has a strict business meaning:
- A workflow is one end-to-end conversation/story slice in the enterprise that accomplishes ONE concrete customer or business use case.
- It starts with a business trigger or intent and ends with a recognizable business/customer outcome.
- It is NOT a function, service call, branch, helper, entity operation, or arbitrary code path.
- A workflow must connect directly to the immediate canonical business concepts it acts on, the business rules that govern it, the durable data it uses, and any next workflow it directly triggers or hands off to.
- Smaller implementation steps stay inside the workflow narrative/evidence. They do not become workflows merely because they are separate functions.

Example workflow: "Customer places an order".
Trigger: a customer starts or resumes a cart and chooses to buy products.
Outcome: a Sales Order is placed/approved and ready for the next business process.
Immediate concepts may include Customer, Sales Order, Order Item and Product. Rules may include inventory requirements or approval rules. A next workflow may be Order fulfillment.

Start from the business use case "What happens when a customer places an order?" and extend into the next connected end-to-end use cases only when the current one is already known and trustworthy.

The repository has ALREADY been prepared before this model call. You are given the authoritative preparation result containing currentCommit, previousCommit, changedFiles and knowledgeReuse. Do NOT call repo_prepare again.

Rules:
1. Treat repoPreparation.knowledgeReuse as authoritative incremental-discovery guidance. Reuse items under reusable without rereading/re-recording them. Re-read only items under needsReview or evidence needed for genuinely new connected workflows.
2. If currentCommit equals previousCommit, move directly to missing knowledge or the next connected workflow instead of rediscovering known facts.
3. If the commit changed, focus on changed files that affect needsReview items plus new code needed for a new connected workflow.
4. Think like a business/process analyst, not like a graph-database or code-documentation tool.
5. Every semantic_record_workflow call MUST describe a complete use case with trigger, outcome, immediate conceptIds, ruleIds and nextWorkflowIds. Record the referenced concepts/rules first when they are new.
6. A workflow with no immediate business concepts is incomplete. A workflow should normally have multiple first-level business connections.
7. Workflows connect to other workflows only where one directly triggers/hands off to the other. Do not connect them merely because they are vaguely related.
8. Visible labels MUST be stable plain-English business names. Never use a raw class/service/entity/variable name as a visible label when a business phrase is possible.
9. Maintain a canonical business glossary. Multiple code terms, variables, statuses or runtime representations of the same durable business object reuse one canonical concept id/label; implementation terms go in technicalNames/evidence.
10. Persistence identity is strong evidence for canonicalization. Exact table/entity names remain persistent-data provenance rather than duplicate business concepts.
11. Every newly recorded concept, rule or persistent dataset must attach to a workflow or another meaningful business relationship immediately.
12. Persistent data must be recorded only when the repository proves a durable database/entity read or write; attach it to workflowId.
13. Business rules/conditions must identify workflowId so they remain visibly attached to the use case they govern.
14. Static/symbolic reasoning is sufficient for config/data branches. Runtime simulation is not required.
15. Never invent evidence. Evidence should include repository-relative path plus symbol/service/line context where possible.
16. Prefer targeted search and bounded file reads. Do not dump the whole repository.
17. Before semantic_complete, verify every newly recorded workflow has a trigger, outcome and visible first-level connections in the semantic map.
18. Finish with a short plain-English summary of what was reused, what changed, and what new business knowledge was added.
19. Make progress in small tool-driven steps. Do not spend a long turn composing prose while more repository evidence is needed.
20. Repository reading is a means, not progress by itself. After enough evidence is available for a business fact, RECORD that semantic fact before doing more broad searches.
`;

  const tools = toChatCompletionTools(modelTools.filter((tool) => tool.name !== 'repo_prepare'));
  const messages = [
    { role: 'system', content: instructions },
    {
      role: 'user',
      content: `Business description:\n${businessDescription}\n\nRepository:\n${repoUrl}\n\nExisting DataSong knowledge:\n${JSON.stringify(priorKnowledge, null, 2)}\n\nRepository preparation result:\n${JSON.stringify(repoPreparation, null, 2)}\n\nObey the knowledgeReuse plan. Build/extend complete end-to-end workflows, not code fragments. Reuse unchanged knowledge, re-check only affected items, then extend the business guide with the next missing connected use case where useful.`
    }
  ];

  let previousCallSignature = '';
  let repeatedCallCount = 0;
  let stagnantRounds = 0;

  for (let round = 0; round < 40; round += 1) {
    const roundNo = round + 1;
    console.log(`[DataSong] DeepSeek round ${roundNo} started`);

    const response = await withTimeout(
      deepseek.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: MAX_MODEL_TOKENS,
        temperature: 0
      }),
      MODEL_TIMEOUT_MS,
      `DeepSeek did not respond within ${Math.round(MODEL_TIMEOUT_MS / 1000)} seconds on round ${roundNo}`
    );

    const choice = response.choices?.[0];
    const message = choice?.message;
    if (!message) throw new Error(`DeepSeek returned no assistant message on round ${roundNo}`);

    const calls = message.tool_calls || [];
    console.log(`[DataSong] DeepSeek round ${roundNo} returned ${calls.length} tool call(s), finish=${choice?.finish_reason || 'unknown'}`);

    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });

    if (!calls.length) {
      if (!message.content?.trim()) throw new Error(`DeepSeek returned neither tool calls nor an answer on round ${roundNo}`);
      if (semanticStore.state.status !== 'complete') semanticStore.complete(message.content || 'Business knowledge updated');
      broadcast();
      return;
    }

    const signature = calls.map((call) => `${call.function?.name}:${call.function?.arguments || '{}'}`).join('|');
    if (signature === previousCallSignature) repeatedCallCount += 1;
    else repeatedCallCount = 0;
    previousCallSignature = signature;

    if (repeatedCallCount >= 2) {
      throw new Error(`DeepSeek repeated the same tool request three times on round ${roundNo}; stopping instead of looping`);
    }

    let semanticWritesThisRound = 0;

    for (const call of calls) {
      const name = call.function?.name;
      let args;
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        throw new Error(`DeepSeek returned invalid JSON arguments for ${name || 'a tool'} on round ${roundNo}`);
      }

      semanticStore.emit({ type: 'tool_started', tool: name, args, message: toolProgressText(name, args) });
      broadcast();

      const result = await executeTool(name, args);
      semanticStore.emit({ type: 'tool_completed', tool: name, args, resultPreview: preview(result) });
      const learned = learningMessage(name, args, result);
      if (learned) semanticStore.emit({ type: 'learning_update', message: learned });
      if (isSemanticWrite(name)) semanticWritesThisRound += 1;
      broadcast();
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }

    if (semanticWritesThisRound > 0) {
      stagnantRounds = 0;
    } else {
      stagnantRounds += 1;
      console.log(`[DataSong] No semantic writes in round ${roundNo}; stagnantRounds=${stagnantRounds}`);
    }

    if (stagnantRounds === STAGNATION_RECOVERY_ROUNDS) {
      messages.push({
        role: 'user',
        content: `Recovery instruction: you have spent ${stagnantRounds} consecutive rounds reading/searching without recording any business knowledge. Stop broad exploration. Using the evidence already gathered, your NEXT turn must either (a) record at least one concrete workflow/concept/rule/persistent-data/relation that is supported by that evidence, or (b) call semantic_complete if there is genuinely nothing new to add. Only perform another repository read if one narrowly identified missing fact blocks a semantic write.`
      });
      console.log('[DataSong] Injected stagnation recovery instruction');
    }

    if (stagnantRounds >= STAGNATION_STOP_ROUNDS) {
      throw new Error(`Exploration made no semantic progress for ${stagnantRounds} consecutive model rounds; stopping instead of looping on repository reads`);
    }

    if (semanticStore.state.status === 'complete') return;
  }

  throw new Error('Exploration reached the 40-round safety limit before completing');
}

function toolProgressText(name, args) {
  if (name === 'repo_list') return `Looking through ${args.path || 'the application structure'}…`;
  if (name === 'repo_search') return `Searching for evidence about ${humanizeQuery(args.query)}…`;
  if (name === 'repo_read_file') return `Reading evidence in ${shortPath(args.path)}…`;
  if (name === 'semantic_record_workflow') return `Writing the end-to-end workflow: ${args.name || 'business flow'}…`;
  if (name === 'semantic_record_node') return `Understanding ${args.label || 'another business concept'}…`;
  if (name === 'semantic_record_relation') return 'Connecting two parts of the business story…';
  if (name === 'semantic_record_persistent_data') return `Tracing where ${args.businessLabel || 'business data'} is stored…`;
  if (name === 'semantic_record_condition') return `Understanding the business rule: ${args.label || 'what changes the path'}…`;
  if (name === 'semantic_complete') return 'Saving the updated business guide against this repository version…';
  return 'Following the business story…';
}

function learningMessage(name, args, result) {
  if (name === 'repo_search') {
    const count = Array.isArray(result) ? result.length : 0;
    return count ? `Found ${count} source clue${count === 1 ? '' : 's'} about ${humanizeQuery(args.query)}.` : null;
  }
  if (name === 'repo_read_file') return `Found source evidence in ${shortPath(args.path)}.`;
  if (name === 'semantic_record_workflow') return `Learned business flow: ${args.name} — ${args.outcome}`;
  if (name === 'semantic_record_node') return `Learned what ${args.label} means in this business.`;
  if (name === 'semantic_record_relation') {
    const snapshot = semanticStore.snapshot();
    const source = snapshot.nodes.find((node) => node.id === args.source)?.label || args.source;
    const target = snapshot.nodes.find((node) => node.id === args.target)?.label || args.target;
    return `Learned: ${source} ${args.relation} ${target}.`;
  }
  if (name === 'semantic_record_persistent_data') return `Learned where ${args.businessLabel} is persisted: ${args.technicalName}.`;
  if (name === 'semantic_record_condition') return `Learned business rule: ${args.label}`;
  if (name === 'semantic_complete') return result?.message || args.summary;
  return null;
}

function isSemanticWrite(name = '') {
  return name.startsWith('semantic_record_') || name === 'semantic_complete';
}

function humanizeQuery(query = '') {
  return query.replace(/[#_]/g, ' ').trim() || 'the next business step';
}

function shortPath(file = '') {
  const parts = file.split('/');
  return parts[parts.length - 1] || 'this source file';
}

function toChatCompletionTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }));
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function preview(value) {
  const text = JSON.stringify(value);
  return text.length > 900 ? `${text.slice(0, 900)}…` : text;
}

function broadcast() {
  const payload = `data: ${JSON.stringify({ type: 'snapshot', state: semanticStore.snapshot() })}\n\n`;
  for (const client of clients) client.write(payload);
}

app.listen(port, () => {
  console.log(`DataSong demo server listening on http://localhost:${port}`);
  console.log(`Model: ${model} via DeepSeek API`);
});
