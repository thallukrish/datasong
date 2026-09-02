import { actionFor } from '../action.js';
export const checkboxScanner = { actions: (input) => [actionFor(input, 'toggle', true, 'probe-toggle'), actionFor(input, 'toggle', false, 'restore-toggle')] };
