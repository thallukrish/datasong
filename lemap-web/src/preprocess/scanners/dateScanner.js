import { actionFor } from '../action.js';
export const dateScanner = { actions: (input) => [
  actionFor(input, 'type', '13/09/2025', 'probe-representative-date'),
  actionFor(input, 'type', '2025-09-13', 'probe-invalid-format')
] };
