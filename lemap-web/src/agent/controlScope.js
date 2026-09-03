function arr(value) { return Array.isArray(value) ? value : []; }
function normalize(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b(selected|current)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  const global = globalControlKeys(memory);
  if (global.has(key)) return 'application';

  // Current entity id is intentionally not special-cased: recurrence is proven from
  // the persisted semantic map across distinct entities, never from repeated renders
  // of one entity.
  void currentEntityId;
  return 'entity';
}
