import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResolvedSymbolTopology } from './resolvedSymbolTopology.js';
import { VerticalSliceExplorer } from './verticalSliceExplorer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataRoot = path.join(root, 'data');
const app = express();
const port = Number(process.env.PORT || 3102);
const clients = new Set();

const topology = new ResolvedSymbolTopology({ cacheRoot: path.join(dataRoot, 'repo-cache') });
const explorer = new VerticalSliceExplorer({
  topology,
  dataRoot,
  onState: (state) => broadcast(state)
});

let running = false;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(root, 'public')));

app.get('/api/state', (_req, res) => res.json(explorer.snapshot()));

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

function broadcast(state) {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) client.write(payload);
}

app.listen(port, () => {
  console.log(`[DataSong v2] http://localhost:${port}`);
  console.log('[DataSong v2] exploration console is intentionally terse; detailed traces go to data/runs/*.jsonl');
});
