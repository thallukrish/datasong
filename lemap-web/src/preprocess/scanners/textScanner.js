import { actionFor } from '../action.js';
export const textScanner = { actions: (input) => [actionFor(input, 'type', 'LeMap', 'probe-text'), actionFor(input, 'clear', '', 'probe-empty')] };
