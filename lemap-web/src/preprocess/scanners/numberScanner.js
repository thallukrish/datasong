import { actionFor } from '../action.js';
export const numberScanner = { actions: (input) => {
  const min = input.attributes?.min;
  const max = input.attributes?.max;
  const value = min != null ? Number(min) : max != null ? Number(max) : 1;
  return [actionFor(input, 'type', value, 'probe-number')];
} };
