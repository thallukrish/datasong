function arr(value) { return Array.isArray(value) ? value : []; }

const registeredSensitiveValues = new Set();

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

function optionSet(structural = {}) {
  return new Set(arr(structural.values).flatMap(scalarValues));
}

export function sensitiveValuesFromEntities(entities = []) {
  const values = new Set();
  for (const entity of arr(entities)) {
    const structural = entity?.structural || {};
    const options = optionSet(structural);
    for (const value of [structural.value, structural.defaultValue]) {
      for (const item of scalarValues(value)) {
        if (!options.has(item)) values.add(item);
      }
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

function redactWithValues(value, sensitiveValues = []) {
  let output = String(value ?? '');
  for (const sensitive of sensitiveValues) {
    if (!sensitive) continue;
    output = output.replace(new RegExp(escapeRegExp(sensitive), 'gi'), '[redacted]');
  }
  return output;
}

export function redactModelText(value, privacyEntities = []) {
  const values = new Set([
    ...registeredSensitiveValues,
    ...sensitiveValuesFromEntities(privacyEntities)
  ]);
  return redactWithValues(value, [...values].sort((a, b) => b.length - a.length));
}

export function registerSensitiveValuesFromEntities(entities = []) {
  for (const value of sensitiveValuesFromEntities(entities)) registeredSensitiveValues.add(value);
}

export function clearRegisteredSensitiveValues() {
  registeredSensitiveValues.clear();
}

export function redactRegisteredModelText(value) {
  return redactWithValues(value, [...registeredSensitiveValues].sort((a, b) => b.length - a.length));
}
