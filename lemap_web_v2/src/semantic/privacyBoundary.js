const RUNTIME_KEYS = new Set([
  'value',
  'runtimeValue',
  'userValue',
  'selectedValue',
  'checked',
  'reference',
  'instances',
  'instanceGraph'
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isPlainObject(value)) return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (RUNTIME_KEYS.has(key)) continue;
    result[key] = sanitizeValue(child);
  }
  return result;
}

export function sanitizeEntityForModel(entity = {}) {
  if (!entity || typeof entity !== 'object') {
    throw new Error('Entity is required.');
  }
  return sanitizeValue(entity);
}

function findUnsafePath(value, path = 'payload') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findUnsafePath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }

  if (!isPlainObject(value)) return null;

  for (const [key, child] of Object.entries(value)) {
    if (RUNTIME_KEYS.has(key)) return `${path}.${key}`;
    const found = findUnsafePath(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

export function assertModelSafe(payload) {
  const unsafePath = findUnsafePath(payload);
  if (unsafePath) {
    throw new Error(`Runtime value field is not model-safe: ${unsafePath}`);
  }
  return payload;
}

export function buildModelPayload({ entityGraph } = {}) {
  if (!entityGraph || !Array.isArray(entityGraph.entities)) {
    throw new Error('An entityGraph with entities is required.');
  }

  const payload = {
    graph: {
      version: entityGraph.version ?? 1,
      entities: entityGraph.entities.map(sanitizeEntityForModel)
    }
  };

  return assertModelSafe(payload);
}
