function arr(value) { return Array.isArray(value) ? value : []; }
let activeMemory = null;

function normalize(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b(selected|current)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function setControlScopeMemory(memory = null) {
  activeMemory = memory;
}

export function controlScopeKey(field = {}) {
  const label = normalize(field.label || field.semanticName || '');
  const type = normalize(field.type || '');
  if (!label || !type) return '';
  return JSON.stringify([label, type]);
}

export function globalControlKeys(memory = {}, { minDistinctEntities = 2 } = {}) {
  const sightings = new Map();
  for (const [entityId, entry] of Object.entries(memory?.entities || {})) {
    for (const field of arr(entry?.structure?.fields)) {
      const key = controlScopeKey(field);
      if (!key) continue;
      if (!sightings.has(key)) sightings.set(key, new Set());
      sightings.get(key).add(entityId);
    }
  }
  return new Set([...sightings.entries()]
    .filter(([, entityIds]) => entityIds.size >= Math.max(2, Number(minDistinctEntities) || 2))
    .map(([key]) => key));
}

export function controlScope(memory = {}, field = {}, currentEntityId = '') {
  const key = controlScopeKey(field);
  if (!key) return 'entity';
  if (globalControlKeys(memory).has(key)) return 'application';
  void currentEntityId;
  return 'entity';
}

export function currentControlScope(field = {}, currentEntityId = '') {
  return controlScope(activeMemory || {}, field, currentEntityId);
}
