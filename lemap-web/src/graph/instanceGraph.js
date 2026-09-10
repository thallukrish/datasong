import crypto from 'node:crypto';

function arr(value) { return Array.isArray(value) ? value : []; }
function hash(value) { return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12); }

export function createInstanceGraph(instances = []) {
  return arr(instances).map((instance) => structuredClone(instance));
}

export function instanceForEntity(instances = [], entityId = '') {
  return arr(instances).find((node) => arr(node.links).some((link) => link.id === entityId && link.relationship === 'instanceOf')) || null;
}

export function upsertInstanceValue(instances = [], entityId = '', value = null, metadata = {}) {
  const id = String(entityId || '');
  if (!id) throw new Error('Entity id is required for instance value');
  const mode = metadata?.mode ? String(metadata.mode) : undefined;
  const source = metadata?.source ? String(metadata.source) : undefined;
  const existing = instanceForEntity(instances, id);
  if (existing) {
    existing.value = structuredClone(value);
    if (mode) existing.mode = mode;
    else delete existing.mode;
    if (source) existing.source = source;
    else delete existing.source;
    return existing;
  }
  const node = {
    id: `instance:${hash(id)}`,
    type: 'instance',
    value: structuredClone(value),
    ...(mode ? { mode } : {}),
    ...(source ? { source } : {}),
    links: [{ id, relationship: 'instanceOf' }]
  };
  instances.push(node);
  return node;
}
