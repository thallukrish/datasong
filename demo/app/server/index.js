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
      baseURL: 'https://api.deepseek.com'
    })
  : null;
const clients = new Set();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/state', (_req, res) => res.json(semanticStore.snapshot()));

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

  semanticStore.begin({ businessDescription, repoUrl });
  broadcast();
  res.status(202).json({ ok: true });

  explore({ businessDescription, repoUrl }).catch((error) => {
    semanticStore.state.status = 'error';
    semanticStore.emit({ type: 'error', message: error.message });
    broadcast();
  });
});

async function explore({ businessDescription, repoUrl }) {
  const instructions = `
You are DataSong examining how a business works by reading its application repository.

This demo is NOT a generic architecture scan. Tell ONE connected, understandable business story:
"What happens when a customer places an order?"

Target story boundary for this first slice:
Customer -> Sales Order -> Order Items -> Product -> inventory decision/check -> order placement/approval.
Stop before shipment, invoicing and payment unless a tiny reference is required to understand the boundary.

Your job is to discover the story from repository evidence and progressively record it in plain business language, while preserving technical evidence underneath.

Rules:
1. Think like a business/process analyst examining an unfamiliar company, not like a graph-database tool.
2. Visible labels MUST be plain English: Customer, Sales Order, Order Items, Product, Inventory required?, Stock available?, Order approval. Never use a raw class/service/entity name as the visible label when a business phrase is possible.
3. Keep exact implementation names in technicalNames, technicalName, fields and evidence. That provenance is important but secondary in the UI.
4. Start by locating evidence for the order-placement flow. Follow calls only as far as needed to explain this slice end-to-end.
5. Every recorded story object must connect to the current story. Do not create isolated concepts, services, datasets or conditions.
6. Record a relation immediately whenever you add a new story object and evidence supports the connection. A useful map is a connected story, not a collection of boxes.
7. Do not add services/functions as primary visible nodes unless they represent a meaningful business step that cannot be expressed otherwise. Prefer keeping services in technicalNames/evidence.
8. Distinguish runtime/transient values from durable data. Only use semantic_record_persistent_data when repository evidence shows a persistent entity/table/database read or write.
9. When persistent data is found, explain what it represents in this business story, keep the exact entity/table name, and connect it to the business concept/workflow it supports.
10. Record important business decisions/branches (for example inventory required or stock availability) when code/config/data controls whether the path continues, changes or stops.
11. Static/symbolic reasoning is sufficient for config/data branches. Runtime simulation is not required.
12. Never invent evidence. Evidence should include repository path plus symbol/service/line context where possible.
13. Prefer targeted search and bounded file reads. Do not dump the whole repository.
14. Before semantic_complete, verify that the main story is visibly connected by relationships and that persistent data hangs off the relevant business steps rather than appearing as unrelated boxes.
15. Finish with a short plain-English summary of what happens when a customer places an order.
`;

  const tools = toChatCompletionTools(modelTools);
  const messages = [
    { role: 'system', content: instructions },
    {
      role: 'user',
      content: `Business description:\n${businessDescription}\n\nRepository:\n${repoUrl}\n\nExamine the repository and tell the connected business story: what happens when a customer places an order? Begin by preparing the repo.`
    }
  ];

  for (let round = 0; round < 80; round += 1) {
    const response = await deepseek.chat.completions.create({ model, messages, tools, tool_choice: 'auto' });
    const message = response.choices?.[0]?.message;
    if (!message) throw new Error('DeepSeek returned no assistant message');

    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });
    const calls = message.tool_calls || [];

    if (!calls.length) {
      if (semanticStore.state.status !== 'complete') semanticStore.complete(message.content || 'Business story explored');
      broadcast();
      return;
    }

    for (const call of calls) {
      const name = call.function?.name;
      const args = JSON.parse(call.function?.arguments || '{}');
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

function toChatCompletionTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }));
}

function preview(value) {
  const text = JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

function broadcast() {
  const payload = `data: ${JSON.stringify({ type: 'snapshot', state: semanticStore.snapshot() })}\n\n`;
  for (const client of clients) client.write(payload);
}

app.listen(port, () => {
  console.log(`DataSong demo server listening on http://localhost:${port}`);
  console.log(`Model: ${model} via DeepSeek API`);
});
