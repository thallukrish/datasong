function arr(value) { return Array.isArray(value) ? value : []; }

function scalarValues(value) {
  if (Array.isArray(value)) return value.flatMap(scalarValues);
  if (value === null || value === undefined || typeof value === 'boolean') return [];
  const text = String(value).trim();
  if (text.length < 4) return [];
  return [text];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sensitiveValuesFromEntities(entities = []) {
  const values = new Set();
  for (const entity of arr(entities)) {
    const structural = entity?.structural || {};
    for (const value of [structural.value, structural.defaultValue]) {
      for (const item of scalarValues(value)) values.add(item);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

export function redactModelText(value, privacyEntities = []) {
  let output = String(value ?? '');
  for (const sensitive of sensitiveValuesFromEntities(privacyEntities)) {
    if (!sensitive) continue;
    output = output.replace(new RegExp(escapeRegExp(sensitive), 'gi'), '[redacted]');
  }
  return output;
}
