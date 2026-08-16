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
You are the DataSong enterprise semantic explorer running a focused product demo.

Goal: inspect an unfamiliar business application's Git repository and progressively construct an evidence-backed semantic map connecting:
- business concepts,
- end-to-end workflows,
- services/functions,
- persistent datasets/entities/tables,
- important configuration or data-driven conditions.

Critical rules:
1. Start from business workflows, not implementation names. Discover several major flows that explain how the stated business operates.
2. Always distinguish runtime/transient values from persistent data. Only call semantic_record_persistent_data when repository evidence shows an entity/table/database read or write.
3. Record persistent fields and the workflow that reads/writes them when evidence supports it.
4. Treat workflow and dataset/table as first-class semantic-map objects.
5. Record branches when config or data values alter reachability or outcomes. Static/symbolic evidence is enough; runtime simulation is not required.
6. Never invent evidence. Evidence strings should include repository path and useful symbol/service/line context.
7. Prefer bounded file reads and targeted searches. Do not dump the entire repository.
8. Record discoveries incrementally as soon as they are supported so the UI can grow while you explore.
9. Do not stop after only one workflow. Build enough of the commerce/order-to-cash map to make the final map useful for a question such as "Why did sales fall last quarter?"
10. Finish with semantic_complete.
`;

  const tools = toChatCompletionTools(modelTools);
  const messages = [
    { role: 'system', content: instructions },
    {
      role: 'user',
      content: `Business description:\n${businessDescription}\n\nRepository:\n${repoUrl}\n\nBegin by preparing the repo, then explore it and build the semantic map.`
    }
  ];

  for (let round = 0; round < 80; round += 1) {
    const response = await deepseek.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto'
    });

    const message = response.choices?.[0]?.message;
    if (!message) throw new Error('DeepSeek returned no assistant message');

    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls
    });

    const calls = message.tool_calls || [];
    if (!calls.length) {
      if (semanticStore.state.status !== 'complete') {
        semanticStore.complete(message.content || 'Exploration complete');
      }
      broadcast();
      return;
    }

    for (const call of calls) {
      const name = call.function?.name;
      const args = JSON.parse(call.function?.arguments || '{}');
      const result = await executeTool(name, args);

      semanticStore.emit({
        type: 'tool_completed',
        tool: name,
        args,
        resultPreview: preview(result)
      });
      broadcast();

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }

    if (semanticStore.state.status === 'complete') return;
  }

  semanticStore.complete('Stopped after exploration safety limit');
  broadcast();
}

function toChatCompletionTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
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
