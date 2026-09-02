import { actionFor } from '../action.js';
export const buttonScanner = { actions: (input) => [actionFor(input, 'click', null, 'invoke-action', 'policy-required')] };
