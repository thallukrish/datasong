import { actionFor } from '../action.js';
export const autocompleteScanner = { actions: (input) => [actionFor(input, 'type', 'ban', 'probe-suggestions')] };
