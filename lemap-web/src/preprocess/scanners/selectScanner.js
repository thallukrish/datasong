import { actionFor } from '../action.js';
export const selectScanner = { actions: (input) => (input.valueDomain || []).map((value) => actionFor(input, 'choose_option', value, 'enumerate-option')) };
