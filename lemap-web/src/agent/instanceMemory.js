import fs from 'node:fs/promises';
import path from 'node:path';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 240) {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max) : s;
}

const VALID_SCOPES = new Set(['application', 'actor', 'workflow', 'workflow_instance']);

export function createInstanceMemory() {
  return { version: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), facts: [] };
}

function normalizeScope(scope) {
  return VALID_SCOPES.has(scope) ? scope : 'workflow_instance';
}

function keyParts(fact = {}) {
  const scope = normalizeScope(fact.scope);
  const workflowKey = ['workflow', 'workflow_instance'].includes(scope) ? text(fact.workflowKey) : '';
  return [text(fact.semanticKey), scope, workflowKey, text(fact.scopeKey)];
}
function factKey(fact = {}) { return keyParts(fact).join('|'); }

export function recordInstanceFact(memory, fact = {}) {
  if (!memory || !Array.isArray(memory.facts)) throw new Error('Invalid instance memory');
  const semanticKey = text(fact.semanticKey);
  if (!semanticKey) return null;
  const normalized = {
    semanticKey,
    value: fact.value ?? null,
    optionLabel: text(fact.optionLabel),
    source: ['user', 'prefill', 'remembered', 'derived'].includes(fact.source) ? fact.source : 'user',
    scope: normalizeScope(fact.scope),
    workflowKey: text(fact.workflowKey),
    scopeKey: text(fact.scopeKey),
    confirmed: fact.confirmed !== false,
    updatedAt: new Date().toISOString()
  };
  const key = factKey(normalized);
  const index = memory.facts.findIndex((item) => factKey(item) === key);
  if (index >= 0) memory.facts[index] = normalized;
  else memory.facts.push(normalized);
  memory.updatedAt = new Date().toISOString();
  return normalized;
}

export function findApplicableFact(memory, { semanticKey = '', workflowKey = '', scope = 'workflow_instance', scopeKey = '' } = {}) {
  const probe = { semanticKey, workflowKey, scope, scopeKey };
  const key = factKey(probe);
  const fact = arr(memory?.facts).find((item) => factKey(item) === key && item.confirmed !== false);
  return fact || null;
}

export async function loadInstanceMemory(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    parsed.facts = arr(parsed.facts);
    parsed.version = 2;
    return parsed;
  } catch {
    return createInstanceMemory();
  }
}

export async function saveInstanceMemory(file, memory) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(memory, null, 2), 'utf8');
}
