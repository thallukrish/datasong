import fs from 'node:fs/promises';
import path from 'node:path';
import { assertModelSafe } from '../semantic/privacyBoundary.js';

const SENSITIVE_KEYS = new Set([
  'value',
  'values',
  'instance',
  'instances',
  'instanceGraph',
  'cookie',
  'cookies',
  'authorization',
  'apiKey',
  'password',
  'secret',
  'token',
  'rawDom',
  'html'
].map((key) => key.toLowerCase()));

function safeSegment(value, fallback = 'run') {
  const normalized = String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function timestampSegment(date) {
  return date.toISOString().replace(/[-:.]/g, '');
}

function assertRuntimeSafe(value, pathParts = []) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertRuntimeSafe(value[index], [...pathParts, String(index)]);
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(String(key).toLowerCase())) {
      throw new Error(`Unsafe or sensitive runtime log field: ${[...pathParts, key].join('.')}`);
    }
    assertRuntimeSafe(child, [...pathParts, key]);
  }
}

export async function createRunLogger({
  directory = 'data/logs',
  workflowId = '',
  layer = 'layer27',
  now = () => new Date()
} = {}) {
  if (typeof now !== 'function') throw new Error('now must be a function.');
  const normalizedLayer = safeSegment(layer, 'layer');
  const normalizedWorkflow = safeSegment(workflowId, 'workflow');
  const createdAt = now();
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) throw new Error('now() must return a valid Date.');

  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${normalizedLayer}-run-${normalizedWorkflow}-${timestampSegment(createdAt)}.jsonl`);
  let sequence = 0;

  const write = async (event) => {
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  };

  return {
    path: filePath,
    layer: normalizedLayer,

    async log(type, data = {}) {
      const normalizedType = String(type ?? '').trim();
      if (!normalizedType) throw new Error('Run log event type is required.');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Run log data must be an object.');
      assertRuntimeSafe(data);
      const event = {
        sequence: sequence += 1,
        timestamp: now().toISOString(),
        type: `${normalizedLayer}.${normalizedType}`,
        ...structuredClone(data)
      };
      await write(event);
      return event;
    },

    async logModelInput(request) {
      assertModelSafe(request);
      const event = {
        sequence: sequence += 1,
        timestamp: now().toISOString(),
        type: `${normalizedLayer}.model.input`,
        request: structuredClone(request)
      };
      await write(event);
      return event;
    },

    async logModelOutput(operation, response) {
      const event = {
        sequence: sequence += 1,
        timestamp: now().toISOString(),
        type: `${normalizedLayer}.model.output`,
        operation: String(operation ?? ''),
        response: structuredClone(response)
      };
      await write(event);
      return event;
    }
  };
}
