import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = fs.readFileSync(path.join(here, '../server/index.js'), 'utf8');
const page = fs.readFileSync(path.join(here, '../public/index.html'), 'utf8');

test('learn state transport uses a lightweight UI projection instead of the full explorer snapshot', () => {
  assert.match(server, /function uiState\(/);
  assert.match(server, /app\.get\('\/api\/workflow\/:id'/);
  assert.match(server, /const payload = `data: \$\{JSON\.stringify\(uiState\(snapshot\)\)\}/);
  const uiStateBody = server.slice(server.indexOf('function uiState('), server.indexOf('function uiState(') + 2500);
  assert.doesNotMatch(uiStateBody, /semanticObjects/);
  assert.doesNotMatch(uiStateBody, /executionStack/);
  assert.doesNotMatch(uiStateBody, /trajectoryEvidence/);
});

test('browser renders initial state before opening SSE', () => {
  assert.match(page, /function startEvents\(\)\{const es=new EventSource\('\/api\/events'\)/);
  assert.match(page, /fetch\('\/api\/state'\)\.then\(r=>r\.json\(\)\)\.then\(s=>\{state=s;controls\(\);renderLearn\(\);if\(screen==='map'\)renderMap\(\);startEvents\(\)\}\)/);
});

test('causal UI shows evidence list and hides acceptance criteria', () => {
  const causalUi = fs.readFileSync(path.join(here, '../public/queryCausalProgress.js'), 'utf8');
  assert.match(causalUi, /accepted causal evidence forming the hypothesis/);
  assert.match(page, /isCausal\s*\? causalEvidence/);
  assert.doesNotMatch(page, /acceptance criteria diagnostics/);
});
