export const STRUCTURAL_PAL_COLUMNS = [
  'row',
  'file',
  'line_range',
  'type',
  'name',
  'parent',
  'children',
  'callers',
  'callees',
  'links',
  'relationships',
  'flowRows',
  'features',
  'details'
];

export const STRUCTURAL_PAL_MULTI_VALUE_COLUMNS = [
  'children',
  'callers',
  'callees',
  'links',
  'relationships',
  'flowRows',
  'features'
];

export function emptyPalArray() {
  return '[]';
}

export function encodePalArray(values = []) {
  return JSON.stringify((Array.isArray(values) ? values : []).map((value) => String(value)));
}
