import { actionFor } from '../action.js';

function deriveSamples(input = {}) {
  const hint = `${input.placeholder || ''} ${input.attributes?.pattern || ''}`.toUpperCase();
  if (/YYYY[^A-Z0-9]?MM[^A-Z0-9]?DD/.test(hint) || input.rawType === 'date') {
    return { valid: '2025-09-13', invalid: '13/09/2025' };
  }
  if (/MM[^A-Z0-9]?DD[^A-Z0-9]?YYYY/.test(hint)) {
    return { valid: '09/13/2025', invalid: '13/09/2025' };
  }
  if (/DD[^A-Z0-9]?MM[^A-Z0-9]?YYYY/.test(hint)) {
    return { valid: '13/09/2025', invalid: '2025-09-13' };
  }
  return null;
}

export const dateScanner = {
  actions(input) {
    const samples = deriveSamples(input);
    if (!samples) return [actionFor(input, 'open_picker', null, 'probe-date-picker')];
    const kind = input.rawType === 'date' ? 'choose_date' : 'type';
    return [
      actionFor(input, kind, samples.valid, 'probe-valid-format'),
      actionFor(input, 'type', samples.invalid, 'probe-invalid-format')
    ];
  }
};
