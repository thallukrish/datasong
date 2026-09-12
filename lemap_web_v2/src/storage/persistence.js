import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createEntityGraph } from '../graph/entityGraph.js';
import { createInstanceGraph, upsertInstance } from '../graph/instanceGraph.js';
import { createWorkflow } from '../workflow/workflowTraversal.js';

async function readJson(file, { missing = null } = {}) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return missing;
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse persisted JSON at ${file}: ${error.message}`);
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temp, file);
}

function assertEntityPayload(payload, file) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.entities)) {
    throw new Error(`Invalid persisted entity graph at ${file}.`);
  }
}

function assertInstancePayload(payload, file) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.instances)) {
    throw new Error(`Invalid persisted instance graph at ${file}.`);
  }
}

function assertWorkflowPayload(payload, file) {
  if (!payload || typeof payload.id !== 'string' || !payload.id || !Array.isArray(payload.steps) || !Number.isInteger(payload.cursor)) {
    throw new Error(`Invalid persisted workflow at ${file}.`);
  }
}

export async function loadEntityGraph(file) {
  const payload = await readJson(file, { missing: { version: 1, entities: [] } });
  assertEntityPayload(payload, file);
  return createEntityGraph({ entities: payload.entities });
}

export async function saveEntityGraph(file, graph) {
  if (!graph || !Array.isArray(graph.entities)) throw new Error('A graph with entities is required.');
  await writeJson(file, { version: 1, entities: structuredClone(graph.entities) });
}

export async function loadInstanceGraph(file) {
  const payload = await readJson(file, { missing: { version: 1, instances: [] } });
  assertInstancePayload(payload, file);
  const graph = createInstanceGraph();
  for (const instance of payload.instances) upsertInstance(graph, instance);
  return graph;
}

export async function saveInstanceGraph(file, graph) {
  if (!graph || !Array.isArray(graph.instances)) throw new Error('An instance graph with instances is required.');
  await writeJson(file, { version: 1, instances: structuredClone(graph.instances) });
}

function slug(value) {
  return String(value || 'workflow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'workflow';
}

function shortHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 10);
}

export function workflowFilePath(directory, workflowId) {
  if (!workflowId) throw new Error('workflowId is required.');
  return path.join(directory, `${slug(workflowId)}-${shortHash(workflowId)}.json`);
}

export async function saveWorkflow(directory, workflow) {
  if (!workflow || !workflow.id || !Array.isArray(workflow.steps)) throw new Error('A workflow with id and steps is required.');
  const file = workflowFilePath(directory, workflow.id);
  await writeJson(file, structuredClone(workflow));
  return file;
}

export async function loadWorkflow(directory, workflowId) {
  const file = workflowFilePath(directory, workflowId);
  const payload = await readJson(file, { missing: null });
  if (payload === null) return null;
  assertWorkflowPayload(payload, file);

  const workflow = createWorkflow({
    id: payload.id,
    originalQuestion: payload.originalQuestion || ''
  });
  workflow.steps = structuredClone(payload.steps);
  workflow.cursor = payload.cursor;
  return workflow;
}
