import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { modelTools, executeTool } from './modelTools.js';
import { semanticStore } from './store.js';

const app = express();
const port = Number(process.env.PORT || 3101);
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const deepseek = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
      timeout: 90_000
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
  // Repository preparation is deterministic and should happen before asking the model
  // anything. This removes the initial 8% dead zone and gives the model an explicit
  // commit-aware reuse plan as its starting context.
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
  broadcast();

  const instructions = `
You are DataSong examining how a business works by reading its application repository.

This demo is NOT a generic architecture scan. Build a connected, understandable business knowledge base starting with:
"What happens when a customer places an order?"

Initial story boundary:
Customer -> Sales Order -> Order Items -> Product -> inventory decision/check -> order placement/approval.
Once an already-known slice is trustworthy, prefer extending the knowledge base into the next connected business flow rather than rediscovering it.

The repository has ALREADY been prepared before this model call. You are given the authoritative preparation result containing currentCommit, previousCommit, changedFiles and knowledgeReuse. Do NOT call repo_prepare again.

Rules:
1. Treat the supplied repoPreparation.knowledgeReuse as authoritative incremental-discovery guidance:
   - reusable: existing semantic items whose supporting evidence is unchanged. Reuse them as-is. DO NOT re-read their evidence or re-record them merely to confirm them.
   - needsReview: existing semantic items whose evidence changed, whose provenance is missing, or whose Git comparison could not be proven. Re-read only the evidence needed to validate/update these.
2. If currentCommit equals previousCommit, do not rediscover already-known items. Move directly to missing knowledge or the next connected workflow.
3. If the commit changed, focus repository inspection on changed files that affect needsReview items, plus new code needed for a new connected workflow. Do not crawl unaffected evidence files.
4. Think like a business/process analyst examining an unfamiliar company, not like a graph-database tool.
5. Visible labels MUST be stable plain-English business names: Customer, Sales Order, Order Item, Product, Inventory required?, Stock available?, Order approval. Never use a raw class/service/entity/variable name as the visible label when a business phrase is possible.
6. MAINTAIN A CANONICAL BUSINESS GLOSSARY. Before recording a new business concept, ask whether it is actually the same durable business thing as something already recorded.
7. If multiple code terms, variables, statuses or runtime representations refer to the same durable business object, DO NOT create separate wiki concepts. Reuse the existing concept id and canonical label, and add implementation terms to technicalNames/evidence instead.
   Example: cartOrderId, session cart order, open order and an OrderOpen record may all be code/runtime descriptions of the same Sales Order while it is being built. If evidence confirms that identity, expose one page named "Sales Order" and keep those names as technical aliases underneath.
8. A state or role difference should become a separate concept only when it has genuinely different business identity, persistence, lifecycle or relationships. Otherwise describe it as a state/condition on the canonical concept.
9. Persistence identity is strong evidence for canonicalization: if two runtime/code names resolve to the same persistent entity and business record identity, normally use one canonical business concept. Exact table/entity names remain separately recorded as persistent-data provenance.
10. Keep exact implementation names in technicalNames, technicalName, fields and evidence. Runtime variables, service parameters and local object names belong there, not in the visible glossary.
11. Every newly recorded story object must connect to the business story. Do not create isolated concepts, services, datasets or conditions.
12. Record a relation immediately whenever you add a new story object and evidence supports the connection.
13. Do not add services/functions as primary visible nodes unless they represent a meaningful business step that cannot be expressed otherwise. Prefer keeping services in technicalNames/evidence.
14. Distinguish runtime/transient values from durable data. Only use semantic_record_persistent_data when repository evidence shows a persistent entity/table/database read or write.
15. When persistent data is found, explain what it represents in this business story, keep the exact entity/table name, and connect it to the canonical business concept/workflow it supports.
16. Record important business decisions/branches when code/config/data controls whether the path continues, changes or stops. Use business wording for the rule; preserve code expressions underneath.
17. Static/symbolic reasoning is sufficient for config/data branches. Runtime simulation is not required.
18. Never invent evidence. Evidence should include repository-relative path plus symbol/service/line context where possible. Repository-relative file paths are important because DataSong stores them as semantic provenance.
19. Prefer targeted search and bounded file reads. Do not dump the whole repository.
20. Before semantic_complete, review the glossary for duplicate concepts/synonyms and consolidate them by reusing/updating canonical ids wherever the evidence says they are the same business thing.
21. Finish with a short plain-English summary of what was reused, what changed, and what new business knowledge was added.
`;

  const tools = toChatCompletionTools(modelTools.filter((tool) => tool.name !== 'repo_prepare'));
  const messages = [
    { role: 'system', content: instructions },
    {
      role: 'user',
      content: `Business description:\n${businessDescription}\n\nRepository:\n${repoUrl}\n\nExisting DataSong knowledge:\n${JSON.stringify(priorKnowledge, null, 2)}\n\nRepository preparation result:\n${JSON.stringify(repoPreparation, null, 2)}\n\nObey the knowledgeReuse plan above. Reuse unchanged semantic items without rediscovering them; re-check only affected items; then extend the business guide with missing or next connected workflows where useful.`
    }
  ];

  for (let round = 0; round < 80; round += 1) {
    semanticStore.emit({ type: 'model_working', round, message: modelProgressText(round) });
    broadcast();

    const response = await deepseek.chat.completions.create({ model, messages, tools, tool_choice: 'auto' });
    const message = response.choices?.[0]?.message;
    if (!message) throw new Error('DeepSeek returned no assistant message');

    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });
    const calls = message.tool_calls || [];

    if (!calls.length) {
      if (semanticStore.state.status !== 'complete') semanticStore.complete(message.content || 'Business knowledge updated');
      broadcast();
      return;
    }

    for (const call of calls) {
      const name = call.function?.name;
      const args = JSON.parse(call.function?.arguments || '{}');

      semanticStore.emit({ type: 'tool_started', tool: name, args, message: toolProgressText(name, args) });
      broadcast();

      const result = await executeTool(name, args);
      semanticStore.emit({ type: 'tool_completed', tool: name, args, resultPreview: preview(result) });
      broadcast();
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }

    if (semanticStore.state.status === 'complete') return;
  }

  semanticStore.complete('Stopped after exploration safety limit');
  broadcast();
}

function toolProgressText(name, args) {
  if (name === 'repo_list') return `Looking through ${args.path || 'the application structure'}…`;
  if (name === 'repo_search') return `Searching for how the business handles ${humanizeQuery(args.query)}…`;
  if (name === 'repo_read_file') return `Reading the part of the application that explains ${shortPath(args.path)}…`;
  if (name === 'semantic_record_workflow') return `Updating the business story: ${args.name || 'business flow'}…`;
  if (name === 'semantic_record_node') return `Understanding ${args.label || 'another part of the business'}…`;
  if (name === 'semantic_record_relation') return 'Connecting two parts of the business story…';
  if (name === 'semantic_record_persistent_data') return `Finding where ${args.businessLabel || 'business data'} is stored…`;
  if (name === 'semantic_record_condition') return `Understanding the rule: ${args.label || 'what changes the path'}…`;
  if (name === 'semantic_complete') return 'Saving the updated business guide against this repository version…';
  return 'Following the business flow…';
}

function modelProgressText(round) {
  if (round === 0) return 'Repository checked. Deciding what needs to be learned next…';
  return 'Reusing unchanged knowledge and connecting new evidence…';
}

function humanizeQuery(query = '') {
  return query.replace(/[#_]/g, ' ').trim() || 'the next step';
}

function shortPath(file = '') {
  const parts = file.split('/');
  return parts[parts.length - 1] || 'this step';
}

function toChatCompletionTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }));
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
