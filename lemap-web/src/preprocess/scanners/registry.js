import { radioScanner } from './radioScanner.js';
import { checkboxScanner } from './checkboxScanner.js';
import { textScanner } from './textScanner.js';
import { numberScanner } from './numberScanner.js';
import { dateScanner } from './dateScanner.js';
import { selectScanner } from './selectScanner.js';
import { autocompleteScanner } from './autocompleteScanner.js';
import { buttonScanner } from './buttonScanner.js';
import { fileScanner } from './fileScanner.js';
import { compositeScanner } from './compositeScanner.js';

const REGISTRY = {
  radio: radioScanner,
  checkbox: checkboxScanner,
  text: textScanner,
  number: numberScanner,
  date: dateScanner,
  select: selectScanner,
  autocomplete: autocompleteScanner,
  button: buttonScanner,
  file: fileScanner,
  composite: compositeScanner,
  unknown: compositeScanner
};

export function scannerFor(input = {}) {
  return REGISTRY[input.type] || compositeScanner;
}
