import { actionFor } from '../action.js';
export const radioScanner = { actions: (input) => [actionFor(input, 'select', input.value, 'enumerate-option')] };
