import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProgressiveRepositoryTopologyV9 } from './progressiveRepositoryTopologyV9.js';
import { ProgressiveRepositoryExplorerV40 } from './progressiveRepositoryExplorerV40.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataRoot = path.join(root, 'data');
const app = express();
const port = Number(process.env.PORT || 3102);
const clients = new Set();

const topology = new ProgressiveRepositoryTopologyV9({ cacheRoot: path.join(dataRoot, 'repo-cache') });
const explorer = new ProgressiveRepositoryExplorerV40({ topology, dataRoot, onState: (state) => broadcast(state) });
let running = false;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(root, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); }
}));
app.get('/api/state', (_req, res) => res.json(explorer.snapshot()));
app.get('/api/call-paths', (_req, res) => res.json({
  ready: !!topology.callPathIndex,
  xmlAdapter: topology.moquiXmlExecution,
  topPaths: topology.callPathIndex ? topology.topCallPaths(10) : []
}));
app.get('/api/run-log', (_req, res) => {
  if (!explorer.runLogPath) return res.status(404).json({ error: 'No run log is available yet' });
  return res.download(explorer.runLogPath, path.basename(explorer.runLogPath));
});
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
    .then((state) => console.log(`[DataSong v2] ${state.status} — ${state.lastMessage || 'exploration finished'}`))
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
app.post('/api/stop', (_req, res) => {
  if (!running) return res.status(409).json({ error: 'No exploration is running' });
  explorer.requestStop();
  return res.json({ ok: true });
});
function broadcast(state) {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) client.write(payload);
}
app.listen(port, () => {
  console.log(`[DataSong v2] http://localhost:${port}`);
  console.log('[DataSong v2] CALL-PATH PREPROCESSOR → PASS 1 → PASS 2');
  console.log('[DataSong v2] Pass 2 navigates the precomputed compressed call-path graph only; Scout is the only layer that scans for missing repository directions. Discovery is disabled.');
});
