import fs from 'node:fs';

const configUrl = new URL('../../../config/structural-pal-schema.json', import.meta.url);
const rawConfig = JSON.parse(fs.readFileSync(configUrl, 'utf8'));

function stringArray(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

export const STRUCTURAL_PAL_SCHEMA_VERSION = Number(rawConfig.version || 1);
export const STRUCTURAL_PAL_COLUMNS = stringArray(rawConfig.columns);
export const STRUCTURAL_PAL_EXCLUDE_COLUMNS = stringArray(rawConfig.excludeColumns);
export const STRUCTURAL_PAL_MULTI_VALUE_COLUMNS = stringArray(rawConfig.multiValueColumns);
export const STRUCTURAL_PAL_COLUMN_TYPES = rawConfig.columnTypes && typeof rawConfig.columnTypes === 'object'
  ? { ...rawConfig.columnTypes }
  : {};

export function structuralPalSchemaConfig() {
  return {
    version: STRUCTURAL_PAL_SCHEMA_VERSION,
    columns: [...STRUCTURAL_PAL_COLUMNS],
    excludeColumns: [...STRUCTURAL_PAL_EXCLUDE_COLUMNS],
    multiValueColumns: [...STRUCTURAL_PAL_MULTI_VALUE_COLUMNS],
    columnTypes: { ...STRUCTURAL_PAL_COLUMN_TYPES }
  };
}

export function emptyPalArray() {
  return '[]';
}

export function encodePalArray(values = []) {
  return JSON.stringify((Array.isArray(values) ? values : []).map((value) => String(value)));
}
